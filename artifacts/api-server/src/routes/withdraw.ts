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
import { getPublicBaseUrl } from "../lib/public-base-url";
import { validateExactInvoiceAmount } from "../lib/lightning-invoice";
import { deriveWithdrawK1 } from "../lib/withdraw-k1";
import { toLnurlWithdrawDescription } from "../lib/lnurl-withdraw";
import { getEffectiveCryptoPayoutSats } from "../lib/effective-crypto-payout";

const PAYOUT_EXPIRY_DAYS = 30;
const PAYOUT_EXPIRY_MS = PAYOUT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

function isPayoutExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > PAYOUT_EXPIRY_MS;
}

const router: IRouter = Router();

/** Encode a URL as LNURL (bech32 with "lnurl" prefix). */
function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500);
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

  if (isPayoutExpired(bet.createdAt)) {
    res.status(410).json({ status: "ERROR", reason: `This payout expired ${PAYOUT_EXPIRY_DAYS} days after the bet was placed.` });
    return;
  }

  // Look up the window for refund detection and asset/outcome context
  const [win] = await db
    .select({ outcome: marketWindowsTable.outcome, asset: marketWindowsTable.asset })
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, bet.windowId))
    .limit(1);

  const isDraw = win?.outcome === "draw";
  const isRefund = win?.outcome === "no_liquidity" || isDraw;
  const asset = (win?.asset ?? "btc").toUpperCase();
  const dirLabel = bet.direction === "up" ? "UP" : "DOWN";
  const payoutSats = getEffectiveCryptoPayoutSats({
    payoutSats: bet.payoutSats,
    amountSats: bet.amountSats,
    windowOutcome: win?.outcome,
  });
  const description = isDraw
    ? `PWSats draw refund ${asset} window ${bet.windowId}`
    : isRefund
    ? `PWSats refund ${asset} window ${bet.windowId}`
    : `PWSats win ${asset} ${dirLabel} 5 min prediction`;

  const base = getPublicBaseUrl(req);
  const callbackUrl = `${base}/api/withdraw/${token}/callback`;

  if (!payoutSats || payoutSats <= 0) {
    res.status(409).json({ status: "ERROR", reason: "No payout amount set for this bet." });
    return;
  }

  const minMsats = payoutSats * 1000;
  const maxMsats = payoutSats * 1000;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1: deriveWithdrawK1(token),
    minWithdrawable: minMsats,
    maxWithdrawable: maxMsats,
    defaultDescription: toLnurlWithdrawDescription(description),
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

  if (k1 !== deriveWithdrawK1(token)) {
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

  const [win] = await db
    .select({ outcome: marketWindowsTable.outcome })
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, bet.windowId))
    .limit(1);

  const payoutSats = getEffectiveCryptoPayoutSats({
    payoutSats: bet.payoutSats,
    amountSats: bet.amountSats,
    windowOutcome: win?.outcome,
  });

  if (!payoutSats || payoutSats <= 0) {
    res.json({ status: "ERROR", reason: "No payout amount set for this bet." });
    return;
  }

  try {
    validateExactInvoiceAmount(pr, payoutSats);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Invalid withdrawal invoice";
    res.json({ status: "ERROR", reason });
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
    await coinosPayInvoice(pr, payoutSats);
    logger.info({ betId: bet.id, payoutSats }, "Winner payout sent via Coinos");
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

/**
 * POST /api/withdraw/:token/pay-to-address
 * Alternative claim flow: user provides their Lightning address and we pay them directly.
 * Resolves the address → LNURL-Pay → invoice → pays via Coinos.
 * Existing QR/LNURL-Withdraw flow is unaffected.
 */
router.post("/withdraw/:token/pay-to-address", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { address } = req.body as { address?: string };

  if (!address || !address.includes("@") || address.split("@").length !== 2) {
    res.status(400).json({ error: "Invalid Lightning address format. Expected user@domain.com" });
    return;
  }

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.withdrawToken, token), eq(betsTable.withdrawStatus, "unclaimed")))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Withdraw token not found or already claimed." });
    return;
  }

  if (bet.status !== "won" || !bet.payoutSats) {
    res.status(409).json({ error: "Bet is not eligible for withdrawal." });
    return;
  }

  if (isPayoutExpired(bet.createdAt)) {
    res.status(410).json({ error: `Payout expired after ${PAYOUT_EXPIRY_DAYS} days.` });
    return;
  }

  const [win] = await db
    .select({ outcome: marketWindowsTable.outcome })
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, bet.windowId))
    .limit(1);

  const payoutSats = getEffectiveCryptoPayoutSats({
    payoutSats: bet.payoutSats,
    amountSats: bet.amountSats,
    windowOutcome: win?.outcome,
  });

  if (!payoutSats || payoutSats <= 0) {
    res.status(409).json({ error: "No payout amount set for this bet." });
    return;
  }

  // Resolve Lightning address → LNURL-Pay metadata
  const [user, domain] = address.split("@");
  const lnurlpUrl = `https://${domain}/.well-known/lnurlp/${user}`;

  let callbackUrl: string;
  let minSendable: number;
  let maxSendable: number;

  try {
    const metaRes = await fetch(lnurlpUrl, { signal: AbortSignal.timeout(10_000) });
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = (await metaRes.json()) as { callback: string; minSendable: number; maxSendable: number; tag: string };
    if (meta.tag !== "payRequest") throw new Error("Not a LNURL-Pay endpoint");
    callbackUrl = meta.callback;
    minSendable = meta.minSendable;
    maxSendable = meta.maxSendable;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ address, err }, "Could not resolve Lightning address");
    res.status(400).json({ error: `Could not reach wallet at ${domain}: ${msg}` });
    return;
  }

  const amountMsats = payoutSats * 1000;
  if (amountMsats < minSendable || amountMsats > maxSendable) {
    res.status(400).json({
      error: `Payout of ${payoutSats} sats is outside the wallet's accepted range (${Math.ceil(minSendable / 1000)}–${Math.floor(maxSendable / 1000)} sats).`,
    });
    return;
  }

  // Get invoice from wallet
  let bolt11: string;
  try {
    const invoiceUrl = new URL(callbackUrl);
    invoiceUrl.searchParams.set("amount", String(amountMsats));
    const invRes = await fetch(invoiceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!invRes.ok) throw new Error(`HTTP ${invRes.status}`);
    const inv = (await invRes.json()) as { pr?: string; reason?: string };
    if (!inv.pr) throw new Error(inv.reason ?? "No invoice in response");
    validateExactInvoiceAmount(inv.pr, payoutSats);
    bolt11 = inv.pr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ address, err }, "Could not get invoice from Lightning address");
    res.status(502).json({ error: `Could not get invoice from wallet: ${msg}` });
    return;
  }

  // Mark as claimed immediately to prevent double-spend
  const [updated] = await db
    .update(betsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(betsTable.id, bet.id), eq(betsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "Payout already claimed (concurrent request)." });
    return;
  }

  try {
    await coinosPayInvoice(bolt11, payoutSats);
    logger.info({ betId: bet.id, payoutSats, address }, "Payout sent to Lightning address");
    res.json({ ok: true });
  } catch (err) {
    // Revert on failure so user can retry
    await db
      .update(betsTable)
      .set({ withdrawStatus: "unclaimed", claimedAt: null })
      .where(eq(betsTable.id, bet.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, betId: bet.id }, "Pay-to-address Coinos payment failed");
    res.status(502).json({ error: `Payment failed: ${msg}` });
  }
});

export { encodeLnurl };
export default router;
