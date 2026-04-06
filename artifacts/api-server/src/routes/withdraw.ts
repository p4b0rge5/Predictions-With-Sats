/**
 * LNURL-Withdraw route (LUD-03)
 *
 * Allows winning bettors to claim their payout by scanning a QR code
 * with any Lightning wallet. The wallet calls our endpoint to get the
 * withdrawal parameters, then sends us an invoice. We pay it via Coinos.
 *
 * Flow:
 *   1. GET /api/withdraw/:token        → returns LUD-03 JSON
 *   2. Wallet sends an invoice to:
 *      GET /api/withdraw/:token/callback?k1=:token&pr=:bolt11
 *   3. We pay the invoice via Coinos and mark the bet as claimed.
 */

import { Router, type IRouter } from "express";
import { bech32 } from "bech32";
import { db, betsTable, marketWindowsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { coinosPayInvoice } from "../lib/coinos";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Encode a URL as LNURL (bech32 with "lnurl" prefix). */
function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500).toUpperCase();
}

/** Build the public base URL for LNURL callbacks. */
function getPublicBase(req: Parameters<Parameters<typeof router.get>[1]>[0]): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

/**
 * GET /api/withdraw/:token
 * Returns LNURL-Withdraw (LUD-03) parameters for the winning bet.
 */
router.get("/withdraw/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.withdrawToken, token))
    .limit(1);

  if (!bet) {
    res.status(404).json({ status: "ERROR", reason: "Withdraw token not found." });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.status(410).json({ status: "ERROR", reason: "This payout has already been claimed." });
    return;
  }

  if (bet.status !== "won" || !bet.payoutSats) {
    res.status(409).json({ status: "ERROR", reason: "Bet is not eligible for withdrawal." });
    return;
  }

  // Look up the window to check if this is a no-liquidity refund
  const [win] = await db
    .select({ outcome: marketWindowsTable.outcome })
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, bet.windowId))
    .limit(1);

  const isRefund = win?.outcome === "no_liquidity";
  const description = isRefund
    ? `Lightning Bet refund — no opposing bets in window #${bet.windowId} — ${bet.payoutSats} sats (2% fee applied)`
    : `Lightning Bet payout — ${bet.payoutSats} sats (window #${bet.windowId})`;

  const base = getPublicBase(req);
  const callbackUrl = `${base}/api/withdraw/${token}/callback`;

  const minMsats = bet.payoutSats * 1000;
  const maxMsats = bet.payoutSats * 1000;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1: token,
    minWithdrawable: minMsats,
    maxWithdrawable: maxMsats,
    defaultDescription: description,
  });
});

/**
 * GET /api/withdraw/:token/callback?k1=:token&pr=:bolt11
 * Called by the wallet after fetching withdrawal params.
 * Pays the provided invoice and marks the bet as claimed.
 */
router.get("/withdraw/:token/callback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { k1, pr } = req.query as { k1?: string; pr?: string };

  if (!k1 || !pr) {
    res.json({ status: "ERROR", reason: "Missing k1 or pr parameters." });
    return;
  }

  if (k1 !== token) {
    res.json({ status: "ERROR", reason: "Invalid k1 parameter." });
    return;
  }

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.withdrawToken, token), eq(betsTable.withdrawStatus, "unclaimed")))
    .limit(1);

  if (!bet) {
    res.json({ status: "ERROR", reason: "Withdraw token not found or already claimed." });
    return;
  }

  if (!bet.payoutSats || bet.payoutSats <= 0) {
    res.json({ status: "ERROR", reason: "No payout amount set for this bet." });
    return;
  }

  // Mark as claimed immediately to prevent double-spends
  const [updated] = await db
    .update(betsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(betsTable.id, bet.id), eq(betsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!updated) {
    res.json({ status: "ERROR", reason: "Payout already claimed (concurrent request)." });
    return;
  }

  try {
    await coinosPayInvoice(pr, bet.payoutSats);
    logger.info({ betId: bet.id, payoutSats: bet.payoutSats }, "Winner payout sent via Coinos");
    res.json({ status: "OK" });
  } catch (err) {
    // Revert claim status so the user can retry
    await db
      .update(betsTable)
      .set({ withdrawStatus: "unclaimed", claimedAt: null })
      .where(eq(betsTable.id, bet.id));

    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, betId: bet.id }, "Coinos payment failed for winner payout");
    res.json({ status: "ERROR", reason: `Payment failed: ${msg}` });
  }
});

export { encodeLnurl };
export default router;
