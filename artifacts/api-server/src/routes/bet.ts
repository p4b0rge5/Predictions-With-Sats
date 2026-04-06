import { Router, type IRouter } from "express";
import { randomUUID, createHash } from "node:crypto";
import {
  CreateBetBody,
  GetBetStatusParams,
  GetBetStatusResponse,
} from "@workspace/api-zod";
import { db, betsTable, marketWindowsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getActiveWindow, getWindowClosesAt } from "../lib/market";
import { getCachedBtcPrice } from "../lib/price";
import { createInvoice } from "../lib/alby";
import { encodeLnurl } from "./withdraw";

const router: IRouter = Router();

const WINDOW_CLOSE_BUFFER_MS = 30 * 1000;
const MIN_AMOUNT_USD = 0.5;
const MIN_AMOUNT_SATS = 10;

router.post("/bet", async (req, res): Promise<void> => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { amountUsd, direction } = parsed.data;

  const [win, btcPriceUsd] = await Promise.all([
    getActiveWindow(),
    getCachedBtcPrice(),
  ]);

  if (!win) {
    res.status(409).json({ error: "No active market window. Try again shortly." });
    return;
  }

  const closesAt = getWindowClosesAt(win.openedAt);
  const msUntilClose = closesAt.getTime() - Date.now();

  if (msUntilClose < WINDOW_CLOSE_BUFFER_MS) {
    res.status(409).json({
      error: "Betting is closed for the last 30 seconds of each window.",
    });
    return;
  }

  const amountSats = Math.round((amountUsd / btcPriceUsd) * 100_000_000);

  if (amountUsd < MIN_AMOUNT_USD) {
    res.status(400).json({
      error: `Minimum bet is $${MIN_AMOUNT_USD.toFixed(2)} USD.`,
    });
    return;
  }

  if (amountSats < MIN_AMOUNT_SATS) {
    res.status(400).json({
      error: `Minimum bet is ${MIN_AMOUNT_SATS} sats. Try a higher USD amount.`,
    });
    return;
  }

  const tempPaymentHash = `pending_${randomUUID()}`;
  const [bet] = await db
    .insert(betsTable)
    .values({
      windowId: win.id,
      direction,
      amountSats,
      paymentHash: tempPaymentHash,
      paymentRequest: "pending",
      status: "pending",
    })
    .returning();

  const memo = `Lightning Bet — ${direction.toUpperCase()} on BTC (window #${win.id})`;

  let invoice: { paymentHash: string; paymentRequest: string; expiresAt: string; verifyUrl: string | null };
  try {
    invoice = await createInvoice(amountSats, memo);
  } catch (err) {
    req.log.error({ err, betId: bet.id }, "Failed to create Alby invoice — expiring orphan bet");
    await db
      .update(betsTable)
      .set({ status: "expired" })
      .where(and(eq(betsTable.id, bet.id), eq(betsTable.paymentHash, tempPaymentHash)));

    const errMsg = err instanceof Error ? err.message : String(err);
    const isAddressError = errMsg.includes("LNURL-Pay") || errMsg.includes("Lightning Address");
    res.status(502).json({
      error: isAddressError
        ? `Payment provider error: ${errMsg}`
        : "Payment provider unavailable. Please try again.",
    });
    return;
  }

  const [updatedBet] = await db
    .update(betsTable)
    .set({
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.paymentRequest,
      verifyUrl: invoice.verifyUrl ?? null,
    })
    .where(eq(betsTable.id, bet.id))
    .returning();

  res.status(201).json({
    id: updatedBet.id,
    paymentHash: updatedBet.paymentHash,
    paymentRequest: updatedBet.paymentRequest,
    amountSats: updatedBet.amountSats,
    direction: updatedBet.direction,
    expiresAt: invoice.expiresAt,
    windowId: updatedBet.windowId,
  });
});

router.get("/bet/:paymentHash", async (req, res): Promise<void> => {
  const params = GetBetStatusParams.safeParse({ paymentHash: req.params.paymentHash });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.paymentHash, params.data.paymentHash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Bet not found." });
    return;
  }

  // Build the LNURL-Withdraw encoded string if the bet has a withdrawToken
  let withdrawLnurl: string | null = null;
  if (bet.withdrawToken && bet.withdrawStatus === "unclaimed") {
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? (req.secure ? "https" : "http");
    const withdrawUrl = `${proto}://${host}/api/withdraw/${bet.withdrawToken}`;
    withdrawLnurl = encodeLnurl(withdrawUrl);
  }

  // Look up the window outcome so the client can detect no-liquidity refunds
  const [window] = await db
    .select({ outcome: marketWindowsTable.outcome })
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, bet.windowId))
    .limit(1);

  const data = GetBetStatusResponse.parse({
    id: bet.id,
    paymentHash: bet.paymentHash,
    direction: bet.direction,
    amountSats: bet.amountSats,
    status: bet.status,
    payoutSats: bet.payoutSats,
    windowId: bet.windowId,
    createdAt: bet.createdAt.toISOString(),
    paidAt: bet.paidAt?.toISOString() ?? null,
    withdrawToken: bet.withdrawToken ?? null,
    withdrawStatus: bet.withdrawStatus ?? null,
    withdrawLnurl,
    windowOutcome: window?.outcome ?? null,
  });

  res.json(data);
});

/**
 * POST /bet/:paymentHash/verify-preimage
 * WebLN payment confirmation: the client provides the payment preimage returned
 * by the paying wallet, we verify SHA256(preimage) === paymentHash and mark paid.
 */
router.post("/bet/:paymentHash/verify-preimage", async (req, res): Promise<void> => {
  const params = GetBetStatusParams.safeParse({ paymentHash: req.params.paymentHash });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const rawPreimage = req.body?.preimage;
  if (typeof rawPreimage !== "string" || rawPreimage.length === 0) {
    res.status(400).json({ error: "preimage field is required" });
    return;
  }

  const { paymentHash } = params.data;
  const preimage = rawPreimage;

  // Verify SHA256(preimage) === paymentHash  (both hex-encoded)
  const derivedHash = createHash("sha256")
    .update(Buffer.from(preimage, "hex"))
    .digest("hex");

  if (derivedHash !== paymentHash) {
    req.log.warn({ paymentHash, derivedHash }, "Preimage verification failed");
    res.status(400).json({ error: "Preimage does not match payment hash" });
    return;
  }

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.paymentHash, paymentHash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Bet not found." });
    return;
  }

  if (bet.status !== "pending") {
    // Already confirmed — just return current state
    res.json({ status: bet.status });
    return;
  }

  const [updated] = await db
    .update(betsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "pending")))
    .returning();

  req.log.info({ betId: bet.id, paymentHash }, "Bet confirmed via WebLN preimage");

  res.json({ status: updated.status });
});

export default router;
