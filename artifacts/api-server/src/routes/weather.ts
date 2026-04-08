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
import { randomUUID, createHash } from "node:crypto";
import { db, weatherMarketsTable, weatherBetsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { addToWeatherPool, WEATHER_CITIES, fetchForecast } from "../lib/weather";
import { createInvoice } from "../lib/alby";
import { coinosPayInvoice } from "../lib/coinos";
import { getCachedBtcPrice } from "../lib/price";
import { logger } from "../lib/logger";
import { bech32 } from "bech32";

const router: IRouter = Router();

const MIN_AMOUNT_USD = 0.50;

// ---------------------------------------------------------------------------
// Temps cache (30-min TTL)
// ---------------------------------------------------------------------------

interface CityTemp {
  key: string;
  name: string;
  emoji: string;
  threshold: number;
  todayMax: number | null;
  tomorrowMax: number | null;
}

let tempsCache: { data: CityTemp[]; ts: number; complete: boolean } | null = null;
const TEMPS_TTL_FULL_MS  = 30 * 60 * 1000; // 30 min when all cities have data
const TEMPS_TTL_PARTIAL_MS = 2 * 60 * 1000; // 2 min when some are null (retry soon)

async function fetchWithRetry(lat: number, lon: number, retries = 3): Promise<WeatherForecast | null> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchForecast(lat, lon);
    } catch {
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 600));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/weather/temps — current forecast max temps for all cities
// ---------------------------------------------------------------------------

router.get("/weather/temps", async (_req, res) => {
  const now = Date.now();
  if (tempsCache) {
    const ttl = tempsCache.complete ? TEMPS_TTL_FULL_MS : TEMPS_TTL_PARTIAL_MS;
    if (now - tempsCache.ts < ttl) return res.json(tempsCache.data);
  }

  // Fetch sequentially to avoid rate-limiting (6 simultaneous requests get dropped)
  const results: CityTemp[] = [];
  for (const city of WEATHER_CITIES) {
    const forecast = await fetchWithRetry(city.latitude, city.longitude);
    results.push({
      key: city.key,
      name: city.name,
      emoji: city.emoji,
      threshold: city.threshold,
      todayMax: forecast?.maxTemps[0] ?? null,
      tomorrowMax: forecast?.maxTemps[1] ?? null,
    } as CityTemp);
    // Small pause between requests to be a good API citizen
    await new Promise((r) => setTimeout(r, 200));
  }

  const complete = results.every((r) => r.todayMax !== null);
  tempsCache = { data: results, ts: now, complete };
  return res.json(results);
});
const PAYOUT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const BTC_SATS = 100_000_000;

function usdToSats(usd: number, btcPriceUsd: number): number {
  return Math.round((usd / btcPriceUsd) * BTC_SATS);
}

function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500).toUpperCase();
}

type ExpressRequest = Parameters<Parameters<typeof router.get>[1]>[0];

function getPublicBase(req: ExpressRequest): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? (req.secure ? "https" : "http");
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------------------
// GET /api/weather/markets
// ---------------------------------------------------------------------------

router.get("/weather/markets", async (_req, res): Promise<void> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const markets = await db
      .select()
      .from(weatherMarketsTable)
      .where(gte(weatherMarketsTable.date, today))
      .orderBy(weatherMarketsTable.date, weatherMarketsTable.city);

    // Attach city emoji
    const cityMap = new Map(WEATHER_CITIES.map((c) => [c.name, c]));

    res.json(
      markets.map((m) => ({
        id: m.id,
        city: m.city,
        country: m.country,
        emoji: cityMap.get(m.city)?.emoji ?? "🌍",
        date: m.date,
        threshold: parseFloat(m.threshold),
        status: m.status,
        outcome: m.outcome,
        actualTemp: m.actualTemp !== null ? parseFloat(m.actualTemp) : null,
        totalYesSats: m.totalYesSats,
        totalNoSats: m.totalNoSats,
        settledAt: m.settledAt?.toISOString() ?? null,
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
  const { marketId, direction, amountUsd } = req.body as {
    marketId?: number;
    direction?: string;
    amountUsd?: number;
  };

  if (!marketId || !direction || !amountUsd) {
    res.status(400).json({ error: "marketId, direction, and amountUsd are required" });
    return;
  }

  if (direction !== "yes" && direction !== "no") {
    res.status(400).json({ error: "direction must be yes or no" });
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

  try {
    const invoice = await createInvoice(
      amountSats,
      `Weather: Will ${market.city} reach ${market.threshold}°C on ${market.date}? (${direction.toUpperCase()})`,
    );

    const [bet] = await db
      .insert(weatherBetsTable)
      .values({
        marketId,
        direction,
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

  const publicBase = getPublicBase(req);
  const withdrawLnurl =
    bet.status === "won" && bet.withdrawToken
      ? encodeLnurl(`${publicBase}/api/weather/withdraw/${bet.withdrawToken}`)
      : null;

  res.json({
    id: bet.id,
    paymentHash: bet.paymentHash,
    direction: bet.direction,
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
          status: market.status,
          outcome: market.outcome ?? null,
          actualTemp: market.actualTemp !== null ? parseFloat(market.actualTemp) : null,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// GET /api/weather/withdraw/:token  (LNURL-Withdraw LUD-03)
// ---------------------------------------------------------------------------

router.get("/weather/withdraw/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const publicBase = getPublicBase(req);

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || bet.status !== "won" || !bet.payoutSats) {
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

  const k1 = createHash("sha256").update(token).digest("hex");
  const callbackUrl = `${publicBase}/api/weather/withdraw/${token}/callback`;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1,
    defaultDescription: `Weather payout: ${bet.payoutSats} sats`,
    minWithdrawable: bet.payoutSats * 1000,
    maxWithdrawable: bet.payoutSats * 1000,
  });
});

// ---------------------------------------------------------------------------
// GET /api/weather/withdraw/:token/callback
// ---------------------------------------------------------------------------

router.get("/weather/withdraw/:token/callback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { pr } = req.query as { pr?: string };

  if (!pr) {
    res.json({ status: "ERROR", reason: "Missing pr parameter" });
    return;
  }

  const [bet] = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || bet.status !== "won") {
    res.json({ status: "ERROR", reason: "Payout not found or not claimable" });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  try {
    await db
      .update(weatherBetsTable)
      .set({ withdrawStatus: "claimed", claimedAt: new Date() })
      .where(eq(weatherBetsTable.id, bet.id));

    await coinosPayInvoice(pr);

    res.json({ status: "OK" });
    logger.info({ betId: bet.id, token }, "Weather payout claimed");
  } catch (err) {
    await db
      .update(weatherBetsTable)
      .set({ withdrawStatus: "unclaimed" })
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
  if (bet.status !== "won" || !bet.payoutSats) { res.status(409).json({ error: "Bet not eligible for withdrawal." }); return; }

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
    const invRes = await fetch(`${callbackUrl}?amount=${amountMsats}`, { signal: AbortSignal.timeout(10_000) });
    if (!invRes.ok) throw new Error(`HTTP ${invRes.status}`);
    const inv = await invRes.json() as { pr?: string; reason?: string };
    if (!inv.pr) throw new Error(inv.reason ?? "No invoice in response");
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
