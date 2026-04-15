/**
 * Weather Prediction Routes
 *
 * GET  /api/weather/markets        — list open/upcoming weather markets
 * POST /api/weather/bets           — place a YES/NO bet (returns Lightning invoice)
 * GET  /api/weather/bets/:hash     — check weather bet status
 * GET  /api/weather/withdraw/:token         — LNURL-Withdraw params
 * GET  /api/weather/withdraw/:token/callback — wallet sends invoice; we pay
 */

import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { db, weatherMarketsTable, weatherBetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  addToWeatherPool,
  getOutcomeForMarket,
  listWeatherMarkets,
} from "../lib/weather";
import { createInvoice } from "../lib/alby";
import { coinosPayInvoice } from "../lib/coinos";
import { getCachedBtcPrice } from "../lib/price";
import { getPublicBaseUrl } from "../lib/public-base-url";
import { logger } from "../lib/logger";
import { validateExactInvoiceAmount } from "../lib/lightning-invoice";
import { deriveWithdrawK1 } from "../lib/withdraw-k1";
import { toLnurlWithdrawDescription } from "../lib/lnurl-withdraw";
import { bech32 } from "bech32";

const router: IRouter = Router();

const MIN_AMOUNT_USD = 0.50;
router.get("/weather/temps", async (_req, res) => {
  res.json([]);
});
const PAYOUT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const BTC_SATS = 100_000_000;

function usdToSats(usd: number, btcPriceUsd: number): number {
  return Math.round((usd / btcPriceUsd) * BTC_SATS);
}

function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500);
}

// ---------------------------------------------------------------------------
// GET /api/weather/markets
// ---------------------------------------------------------------------------

router.get("/weather/markets", async (_req, res): Promise<void> => {
  try {
    const markets = await listWeatherMarkets();

    res.json(
      markets.map((m) => ({
        id: m.id,
        city: m.city,
        country: m.country,
        emoji: "🌡️",
        date: m.date,
        threshold: Number.parseFloat(m.threshold),
        question: m.question ?? `Weather market · ${m.city}`,
        subtitle: m.subtitle ?? null,
        sourceUrl: m.sourceUrl ?? null,
        status: m.status,
        outcome: m.winningOutcome ?? m.outcome,
        actualTemp: m.actualTemp !== null ? parseFloat(m.actualTemp) : null,
        totalYesSats: m.totalYesSats,
        totalNoSats: m.totalNoSats,
        settledAt: m.settledAt?.toISOString() ?? null,
        resolvedValue: m.resolvedValue ?? null,
        provider: m.provider,
        outcomes: Array.isArray(m.outcomes) ? m.outcomes : [],
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /api/weather/markets error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/weather/bets
// ---------------------------------------------------------------------------

router.post("/weather/bets", async (req, res): Promise<void> => {
  const { marketId, direction, outcomeKey, amountUsd } = req.body as {
    marketId?: number;
    direction?: string;
    outcomeKey?: string;
    amountUsd?: number;
  };
  const selectedOutcomeKey = outcomeKey ?? direction;

  if (!marketId || !selectedOutcomeKey || !amountUsd) {
    res.status(400).json({ error: "marketId, outcomeKey, and amountUsd are required" });
    return;
  }

  if (amountUsd < MIN_AMOUNT_USD) {
    res.status(400).json({ error: `Minimum bet is $${MIN_AMOUNT_USD.toFixed(2)} USD` });
    return;
  }

  const btcPriceUsd = await getCachedBtcPrice();
  const amountSats = usdToSats(amountUsd, btcPriceUsd);

  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(and(eq(weatherMarketsTable.id, marketId), eq(weatherMarketsTable.status, "open")))
    .limit(1);

  if (!market) {
    res.status(404).json({ error: "Weather market not found or not open" });
    return;
  }

  const outcome = getOutcomeForMarket(market, selectedOutcomeKey);
  if (!outcome) {
    res.status(400).json({ error: "Selected outcome is not valid for this weather market" });
    return;
  }

  try {
    const invoice = await createInvoice(
      amountSats,
      `Weather: ${market.question ?? market.city} (${outcome.label})`,
    );

    const [bet] = await db
      .insert(weatherBetsTable)
      .values({
        marketId,
        direction: selectedOutcomeKey,
        outcomeLabel: outcome.label,
        amountSats,
        paymentHash: invoice.paymentHash,
        paymentRequest: invoice.paymentRequest,
        verifyUrl: invoice.verifyUrl ?? null,
        status: "pending",
      })
      .returning();

    res.json({
      betId: bet.id,
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.paymentRequest,
      verifyUrl: invoice.verifyUrl ?? null,
      amountSats,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/weather/bets error");
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/weather/bets/:hash
// ---------------------------------------------------------------------------

router.get("/weather/bets/:hash", async (req, res): Promise<void> => {
  const { hash } = req.params;

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.paymentHash, hash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }

  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, bet.marketId))
    .limit(1);

  const publicBase = getPublicBaseUrl(req);
  const withdrawLnurl =
    (bet.status === "won" || bet.status === "refunded") && bet.withdrawToken && bet.withdrawStatus === "unclaimed"
      ? encodeLnurl(`${publicBase}/api/weather/withdraw/${bet.withdrawToken}`)
      : null;

  res.json({
    id: bet.id,
    paymentHash: bet.paymentHash,
    direction: bet.direction,
    outcomeLabel: bet.outcomeLabel ?? null,
    amountSats: bet.amountSats,
    status: bet.status,
    payoutSats: bet.payoutSats ?? null,
    withdrawToken: bet.withdrawToken ?? null,
    withdrawLnurl,
    withdrawStatus: bet.withdrawStatus ?? null,
    createdAt: bet.createdAt.toISOString(),
    paidAt: bet.paidAt?.toISOString() ?? null,
    market: market
      ? {
          city: market.city,
          date: market.date,
          threshold: parseFloat(market.threshold),
          question: market.question ?? null,
          subtitle: market.subtitle ?? null,
          status: market.status,
          outcome: market.winningOutcome ?? market.outcome ?? null,
          actualTemp: market.actualTemp !== null ? parseFloat(market.actualTemp) : null,
          resolvedValue: market.resolvedValue ?? null,
          outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/weather/bets/:hash/verify
// ---------------------------------------------------------------------------

router.post("/weather/bets/:hash/verify", async (req, res): Promise<void> => {
  const { hash } = req.params;
  const rawPreimage = req.body?.preimage;

  if (typeof rawPreimage !== "string" || rawPreimage.trim().length === 0) {
    res.status(400).json({ error: "preimage field is required" });
    return;
  }

  const preimage = rawPreimage.trim().toLowerCase();
  const computedHash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
  if (computedHash !== hash.toLowerCase()) {
    res.status(400).json({ error: "Invalid preimage for this payment hash" });
    return;
  }

  const [bet] = await db
    .update(weatherBetsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(weatherBetsTable.paymentHash, hash), eq(weatherBetsTable.status, "pending")))
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Bet not found or already confirmed" });
    return;
  }

  try {
    await addToWeatherPool(bet.marketId, bet.direction, bet.amountSats);
  } catch (err) {
    logger.warn({ err, weatherBetId: bet.id }, "Failed to update weather outcome pool after preimage verify");
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/weather/withdraw/:token  (LNURL-Withdraw LUD-03)
// ---------------------------------------------------------------------------

router.get("/weather/withdraw/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const publicBase = getPublicBaseUrl(req);

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || (bet.status !== "won" && bet.status !== "refunded") || !bet.payoutSats) {
    res.status(404).json({ status: "ERROR", reason: "Payout not found or not claimable" });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.status(410).json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  const createdAt = bet.paidAt ?? bet.createdAt;
  if (Date.now() - createdAt.getTime() > PAYOUT_EXPIRY_MS) {
    res.status(410).json({ status: "ERROR", reason: "Payout expired" });
    return;
  }

  const callbackUrl = `${publicBase}/api/weather/withdraw/${token}/callback`;

  // Join market for city/date/threshold context
  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, bet.marketId))
    .limit(1);

  const city      = market?.city ?? "Unknown";
  const date      = market?.date ? ` ${market.date}` : "";
  const pickLabel = bet.outcomeLabel ?? bet.direction;
  const defaultDescription =
    bet.status === "refunded"
      ? `PWSats refund ${city}${date} Weather`
      : `PWSats win ${pickLabel} ${city}${date} Weather`;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1: deriveWithdrawK1(token),
    defaultDescription: toLnurlWithdrawDescription(defaultDescription),
    minWithdrawable: bet.payoutSats * 1000,
    maxWithdrawable: bet.payoutSats * 1000,
  });
});

// ---------------------------------------------------------------------------
// GET /api/weather/withdraw/:token/callback
// ---------------------------------------------------------------------------

router.get("/weather/withdraw/:token/callback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { k1, pr } = req.query as { k1?: string; pr?: string };

  if (!k1 || !pr) {
    res.json({ status: "ERROR", reason: "Missing k1 or pr parameter" });
    return;
  }

  if (k1 !== deriveWithdrawK1(token)) {
    res.json({ status: "ERROR", reason: "Invalid k1 parameter" });
    return;
  }

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || (bet.status !== "won" && bet.status !== "refunded")) {
    res.json({ status: "ERROR", reason: "Payout not found or not claimable" });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  if (bet.payoutSats === null) {
    res.json({ status: "ERROR", reason: "Payout amount not available" });
    return;
  }

  try {
    validateExactInvoiceAmount(pr, bet.payoutSats);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Invalid withdrawal invoice";
    res.json({ status: "ERROR", reason });
    return;
  }

  try {
    const [claimed] = await db
      .update(weatherBetsTable)
      .set({ withdrawStatus: "claimed", claimedAt: new Date() })
      .where(and(eq(weatherBetsTable.id, bet.id), eq(weatherBetsTable.withdrawStatus, "unclaimed")))
      .returning();

    if (!claimed) {
      res.json({ status: "ERROR", reason: "Already claimed" });
      return;
    }

    await coinosPayInvoice(pr, bet.payoutSats);

    res.json({ status: "OK" });
    logger.info({ betId: bet.id, token }, "Weather payout claimed");
  } catch (err) {
    await db
      .update(weatherBetsTable)
      .set({ withdrawStatus: "unclaimed", claimedAt: null })
      .where(eq(weatherBetsTable.id, bet.id));
    logger.error({ err, betId: bet.id }, "Weather payout failed");
    res.json({ status: "ERROR", reason: "Payment failed" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/weather/withdraw/:token/pay-to-address
// Alternative claim: user provides Lightning address; we pay them directly.
// ---------------------------------------------------------------------------

router.post("/weather/withdraw/:token/pay-to-address", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { address } = req.body as { address?: string };

  if (!address || !address.includes("@") || address.split("@").length !== 2) {
    res.status(400).json({ error: "Invalid Lightning address format." });
    return;
  }

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(and(eq(weatherBetsTable.withdrawToken, token), eq(weatherBetsTable.withdrawStatus, "unclaimed")))
    .limit(1);

  if (!bet) { res.status(404).json({ error: "Withdraw token not found or already claimed." }); return; }
  if ((bet.status !== "won" && bet.status !== "refunded") || !bet.payoutSats) { res.status(409).json({ error: "Bet not eligible for withdrawal." }); return; }

  const [user, domain] = address.split("@");
  let callbackUrl: string, minSendable: number, maxSendable: number;
  try {
    const metaRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`, { signal: AbortSignal.timeout(10_000) });
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = await metaRes.json() as { callback: string; minSendable: number; maxSendable: number; tag: string };
    if (meta.tag !== "payRequest") throw new Error("Not a LNURL-Pay endpoint");
    callbackUrl = meta.callback; minSendable = meta.minSendable; maxSendable = meta.maxSendable;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Could not reach wallet at ${domain}: ${msg}` }); return;
  }

  const amountMsats = bet.payoutSats * 1000;
  if (amountMsats < minSendable || amountMsats > maxSendable) {
    res.status(400).json({ error: `Payout of ${bet.payoutSats} sats is outside the wallet's accepted range.` }); return;
  }

  let bolt11: string;
  try {
    const invoiceUrl = new URL(callbackUrl);
    invoiceUrl.searchParams.set("amount", String(amountMsats));
    const invRes = await fetch(invoiceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!invRes.ok) throw new Error(`HTTP ${invRes.status}`);
    const inv = await invRes.json() as { pr?: string; reason?: string };
    if (!inv.pr) throw new Error(inv.reason ?? "No invoice in response");
    validateExactInvoiceAmount(inv.pr, bet.payoutSats);
    bolt11 = inv.pr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Could not get invoice from wallet: ${msg}` }); return;
  }

  const [updated] = await db
    .update(weatherBetsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(weatherBetsTable.withdrawToken, token), eq(weatherBetsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!updated) { res.status(409).json({ error: "Payout already claimed." }); return; }

  try {
    await coinosPayInvoice(bolt11, bet.payoutSats);
    logger.info({ betId: bet.id, payoutSats: bet.payoutSats, address }, "Weather payout sent to Lightning address");
    res.json({ ok: true });
  } catch (err) {
    await db.update(weatherBetsTable).set({ withdrawStatus: "unclaimed", claimedAt: null }).where(eq(weatherBetsTable.id, bet.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, betId: bet.id }, "Weather pay-to-address failed");
    res.status(502).json({ error: `Payment failed: ${msg}` });
  }
});

export default router;
