import { Router, type IRouter } from "express";
import {
  CreateBetBody,
  GetBetStatusParams,
  GetBetStatusResponse,
} from "@workspace/api-zod";
import { db, betsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getActiveWindow, getWindowClosesAt } from "../lib/market";
import { getCachedBtcPrice } from "../lib/price";
import { createInvoice } from "../lib/alby";

const router: IRouter = Router();

const WINDOW_CLOSE_BUFFER_MS = 30 * 1000;
const MIN_AMOUNT_SATS = 100;

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

  if (amountSats < MIN_AMOUNT_SATS) {
    res.status(400).json({
      error: `Minimum bet is ${MIN_AMOUNT_SATS} sats. Try a higher USD amount.`,
    });
    return;
  }

  const memo = `Lightning Bet — ${direction.toUpperCase()} on BTC (window #${win.id})`;

  let invoice: { paymentHash: string; paymentRequest: string; expiresAt: string };
  try {
    invoice = await createInvoice(amountSats, memo);
  } catch (err) {
    req.log.error({ err }, "Failed to create Alby invoice");
    res.status(502).json({ error: "Payment provider unavailable. Please try again." });
    return;
  }

  const [bet] = await db
    .insert(betsTable)
    .values({
      windowId: win.id,
      direction,
      amountSats,
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.paymentRequest,
      status: "pending",
    })
    .returning();

  res.status(201).json({
    id: bet.id,
    paymentHash: bet.paymentHash,
    paymentRequest: bet.paymentRequest,
    amountSats: bet.amountSats,
    direction: bet.direction,
    expiresAt: invoice.expiresAt,
    windowId: bet.windowId,
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
  });

  res.json(data);
});

export default router;
