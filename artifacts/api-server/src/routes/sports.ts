/**
 * Sports Prediction Routes
 *
 * GET  /api/sports/events                    — list upcoming/finished events from TheSportsDB
 * GET  /api/sports/markets                   — list open sport markets with pool totals
 * POST /api/sports/bets                      — place a bet on a sport market (returns Lightning invoice)
 * GET  /api/sports/bets/:hash                — check sport bet status + withdraw info
 * POST /api/sports/bets/:hash/verify-preimage — WebLN preimage confirmation
 * GET  /api/sports/withdraw/:token           — LNURL-Withdraw params (LUD-03)
 * GET  /api/sports/withdraw/:token/callback  — wallet sends invoice here; we pay via Coinos
 */

import { Router, type IRouter } from "express";
import { randomUUID, createHash } from "node:crypto";
import { db, sportBetsTable, sportMarketsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getSportsEvents, type SportEvent } from "../lib/sports";
import { getNbaEvents } from "../lib/nba";
import { getNflEvents } from "../lib/nfl";
import { getMlbEvents } from "../lib/mlb";
import { findOrCreateMarket, addToPool } from "../lib/sports-market";
import { createInvoice } from "../lib/alby";
import { coinosPayInvoice } from "../lib/coinos";
import { logger } from "../lib/logger";
import { bech32 } from "bech32";

const router: IRouter = Router();

const MIN_AMOUNT_SATS = 250;
const PAYOUT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeLnurlSports(url: string): string {
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
// GET /api/sports/events
// ---------------------------------------------------------------------------

router.get("/sports/events", async (req, res): Promise<void> => {
  try {
    const [soccer, nba, nfl, mlb] = await Promise.all([getSportsEvents(), getNbaEvents(), getNflEvents(), getMlbEvents()]);

    const allMarkets = await db.select().from(sportMarketsTable);
    const marketsByEventId = new Map(
      allMarkets.map((m) => [
        m.eventId,
        {
          totalHomeSats: m.totalHomeSats,
          totalDrawSats: m.totalDrawSats,
          totalAwaySats: m.totalAwaySats,
          marketId: m.id,
          status: m.status,
          outcome: m.outcome,
          settledAt: m.settledAt?.toISOString() ?? null,
        },
      ]),
    );

    const enrich = (ev: SportEvent) => {
      const market = marketsByEventId.get(ev.id);
      return {
        ...ev,
        marketId: market?.marketId ?? null,
        totalHomeSats: market?.totalHomeSats ?? 0,
        totalDrawSats: market?.totalDrawSats ?? 0,
        totalAwaySats: market?.totalAwaySats ?? 0,
        marketStatus: market?.status ?? null,
        marketOutcome: market?.outcome ?? null,
        marketSettledAt: market?.settledAt ?? null,
      };
    };

    const enriched = {
      upcoming:     [...soccer.upcoming, ...nba.upcoming, ...nfl.upcoming, ...mlb.upcoming].map(enrich),
      finished:     [...soccer.finished, ...nba.finished, ...nfl.finished, ...mlb.finished].map(enrich),
      suspended:    soccer.suspended,
      nbaSuspended: nba.suspended,
      nflSuspended: nfl.suspended,
      mlbSuspended: mlb.suspended,
    };

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch sports events");
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sports/markets
// ---------------------------------------------------------------------------

router.get("/sports/markets", async (_req, res): Promise<void> => {
  const markets = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.status, "open"));
  res.json(markets);
});

// ---------------------------------------------------------------------------
// POST /api/sports/bets
// ---------------------------------------------------------------------------

router.post("/sports/bets", async (req, res): Promise<void> => {
  const { eventId, direction, amountSats } = req.body ?? {};

  if (!eventId || typeof eventId !== "string") {
    res.status(400).json({ error: "eventId is required" });
    return;
  }
  if (direction !== "home" && direction !== "draw" && direction !== "away") {
    res.status(400).json({ error: "direction must be 'home', 'draw', or 'away'" });
    return;
  }
  if (!amountSats || typeof amountSats !== "number" || amountSats < MIN_AMOUNT_SATS) {
    res.status(400).json({ error: `Minimum bet is ${MIN_AMOUNT_SATS} sats` });
    return;
  }

  const [soccer, nba, nfl, mlb] = await Promise.all([getSportsEvents(), getNbaEvents(), getNflEvents(), getMlbEvents()]);
  const allUpcoming = [...soccer.upcoming, ...nba.upcoming, ...nfl.upcoming, ...mlb.upcoming];
  const event = allUpcoming.find((e: SportEvent) => e.id === eventId);
  if (!event) {
    res.status(404).json({ error: "Event not found or not available for betting" });
    return;
  }

  const kickoff = new Date(event.startsAt).getTime();
  if (Date.now() > kickoff - 5 * 60 * 1000) {
    res.status(409).json({ error: "Betting is closed — match kicks off in less than 5 minutes" });
    return;
  }

  const market = await findOrCreateMarket(event);
  if (market.status !== "open") {
    res.status(409).json({ error: "This market is already closed" });
    return;
  }

  const tempHash = `pending_${randomUUID()}`;
  const [bet] = await db
    .insert(sportBetsTable)
    .values({
      marketId: market.id,
      direction,
      amountSats,
      paymentHash: tempHash,
      paymentRequest: "pending",
      status: "pending",
    })
    .returning();

  const teamLabel =
    direction === "home" ? market.homeTeam : direction === "away" ? market.awayTeam : "DRAW";
  const memo = `PWSats — ${teamLabel} (${market.league})`;

  let invoice: { paymentHash: string; paymentRequest: string; expiresAt: string; verifyUrl: string | null };
  try {
    invoice = await createInvoice(amountSats, memo);
  } catch (err) {
    await db
      .update(sportBetsTable)
      .set({ status: "expired" })
      .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.paymentHash, tempHash)));
    req.log.error({ err }, "Failed to create sport bet invoice");
    res.status(502).json({ error: "Payment provider unavailable. Please try again." });
    return;
  }

  const [updatedBet] = await db
    .update(sportBetsTable)
    .set({
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.paymentRequest,
      verifyUrl: invoice.verifyUrl ?? null,
    })
    .where(eq(sportBetsTable.id, bet.id))
    .returning();

  res.status(201).json({
    id: updatedBet.id,
    paymentHash: updatedBet.paymentHash,
    paymentRequest: updatedBet.paymentRequest,
    amountSats: updatedBet.amountSats,
    direction: updatedBet.direction,
    expiresAt: invoice.expiresAt,
    marketId: market.id,
    homeTeam: market.homeTeam,
    awayTeam: market.awayTeam,
    eventName: market.eventName,
    league: market.league,
  });
});

// ---------------------------------------------------------------------------
// GET /api/sports/bets/:hash
// ---------------------------------------------------------------------------

router.get("/sports/bets/:hash", async (req, res): Promise<void> => {
  const { hash } = req.params;

  const [bet] = await db
    .select()
    .from(sportBetsTable)
    .where(eq(sportBetsTable.paymentHash, hash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Sport bet not found" });
    return;
  }

  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.id, bet.marketId))
    .limit(1);

  let withdrawLnurl: string | null = null;
  if (bet.withdrawToken && bet.withdrawStatus === "unclaimed") {
    const base = getPublicBase(req);
    const withdrawUrl = `${base}/api/sports/withdraw/${bet.withdrawToken}`;
    withdrawLnurl = encodeLnurlSports(withdrawUrl);
  }

  res.json({
    id: bet.id,
    paymentHash: bet.paymentHash,
    direction: bet.direction,
    amountSats: bet.amountSats,
    status: bet.status,
    payoutSats: bet.payoutSats,
    marketId: bet.marketId,
    createdAt: bet.createdAt.toISOString(),
    paidAt: bet.paidAt?.toISOString() ?? null,
    withdrawToken: bet.withdrawToken ?? null,
    withdrawStatus: bet.withdrawStatus ?? null,
    withdrawLnurl,
    market: market
      ? {
          eventName: market.eventName,
          homeTeam: market.homeTeam,
          awayTeam: market.awayTeam,
          homeBadge: market.homeBadge ?? null,
          awayBadge: market.awayBadge ?? null,
          league: market.league,
          status: market.status,
          outcome: market.outcome,
          startsAt: market.startsAt.toISOString(),
          homeScore: market.homeScore ?? null,
          awayScore: market.awayScore ?? null,
          settledAt: market.settledAt?.toISOString() ?? null,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/sports/bets/:hash/verify-preimage
// ---------------------------------------------------------------------------

router.post("/sports/bets/:hash/verify-preimage", async (req, res): Promise<void> => {
  const { hash } = req.params;
  const rawPreimage = req.body?.preimage;

  if (typeof rawPreimage !== "string" || rawPreimage.length === 0) {
    res.status(400).json({ error: "preimage field is required" });
    return;
  }

  const derivedHash = createHash("sha256")
    .update(Buffer.from(rawPreimage, "hex"))
    .digest("hex");

  if (derivedHash !== hash) {
    res.status(400).json({ error: "Preimage does not match payment hash" });
    return;
  }

  const [bet] = await db
    .select()
    .from(sportBetsTable)
    .where(eq(sportBetsTable.paymentHash, hash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Sport bet not found" });
    return;
  }

  if (bet.status !== "pending") {
    res.json({ status: bet.status });
    return;
  }

  const [updated] = await db
    .update(sportBetsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "pending")))
    .returning();

  try {
    const { addToPool: addPoolFn } = await import("../lib/sports-market");
    await addPoolFn(bet.marketId, bet.direction as "home" | "draw" | "away", Number(bet.amountSats));
  } catch (err) {
    logger.warn({ err, sportBetId: bet.id }, "Failed to update pool after preimage verify");
  }

  logger.info({ sportBetId: bet.id, hash }, "Sport bet confirmed via WebLN preimage");
  res.json({ status: updated.status });
});

// ---------------------------------------------------------------------------
// GET /api/sports/withdraw/:token  (LUD-03 params)
// ---------------------------------------------------------------------------

router.get("/sports/withdraw/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [bet] = await db
    .select()
    .from(sportBetsTable)
    .where(eq(sportBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet) {
    res.status(404).json({ status: "ERROR", reason: "Withdraw token not found" });
    return;
  }

  if (bet.status !== "won" && bet.status !== "refunded") {
    res.status(400).json({ status: "ERROR", reason: "Bet not eligible for withdrawal" });
    return;
  }

  if (bet.withdrawStatus !== "unclaimed") {
    res.status(400).json({ status: "ERROR", reason: "Payout already claimed" });
    return;
  }

  if (Date.now() - bet.createdAt.getTime() > PAYOUT_EXPIRY_MS) {
    res.status(400).json({ status: "ERROR", reason: "Payout expired (30-day window passed)" });
    return;
  }

  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.id, bet.marketId))
    .limit(1);

  const payoutSats = Number(bet.payoutSats ?? 0);
  const base = getPublicBase(req);
  const callbackUrl = `${base}/api/sports/withdraw/${token}/callback`;

  const directionLabel =
    bet.direction === "home"  ? `${market?.homeTeam ?? "Home"} (HOME)`
    : bet.direction === "away" ? `${market?.awayTeam ?? "Away"} (AWAY)`
    : "DRAW";

  const scoreLabel =
    market?.homeScore != null && market?.awayScore != null
      ? ` · ${market.homeScore}–${market.awayScore}`
      : "";

  const defaultDescription =
    bet.status === "refunded"
      ? `PWSats Refund — ${market?.eventName ?? "Sports Bet"}${scoreLabel}`
      : `PWSats Win — ${directionLabel} — ${market?.eventName ?? "Sports Bet"}${scoreLabel} (${market?.league ?? ""})`;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1: token,
    defaultDescription,
    minWithdrawable: payoutSats * 1000,
    maxWithdrawable: payoutSats * 1000,
  });
});

// ---------------------------------------------------------------------------
// GET /api/sports/withdraw/:token/callback  (wallet sends invoice)
// ---------------------------------------------------------------------------

router.get("/sports/withdraw/:token/callback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { k1, pr } = req.query as { k1?: string; pr?: string };

  if (k1 !== token || !pr) {
    res.json({ status: "ERROR", reason: "Invalid callback parameters" });
    return;
  }

  const [bet] = await db
    .select()
    .from(sportBetsTable)
    .where(eq(sportBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || bet.withdrawStatus !== "unclaimed") {
    res.json({ status: "ERROR", reason: "Token not found or already claimed" });
    return;
  }

  if (bet.status !== "won" && bet.status !== "refunded") {
    res.json({ status: "ERROR", reason: "Bet not eligible for withdrawal" });
    return;
  }

  // Atomic claim guard — prevent double-spend
  const [claimed] = await db
    .update(sportBetsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(sportBetsTable.withdrawToken, token), eq(sportBetsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!claimed) {
    res.json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  try {
    await coinosPayInvoice(pr);
    logger.info({ sportBetId: bet.id, token }, "Sport payout sent via Coinos");
    res.json({ status: "OK" });
  } catch (err) {
    // Roll back on failure
    await db
      .update(sportBetsTable)
      .set({ withdrawStatus: "unclaimed", claimedAt: null })
      .where(eq(sportBetsTable.id, bet.id));
    logger.error({ err, sportBetId: bet.id }, "Failed to pay sport payout via Coinos");
    res.json({ status: "ERROR", reason: "Payment failed. Please try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sports/withdraw/:token/pay-to-address
// Alternative claim: user provides Lightning address; we pay them directly.
// ---------------------------------------------------------------------------

router.post("/sports/withdraw/:token/pay-to-address", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { address } = req.body as { address?: string };

  if (!address || !address.includes("@") || address.split("@").length !== 2) {
    res.status(400).json({ error: "Invalid Lightning address format." });
    return;
  }

  const [bet] = await db
    .select()
    .from(sportBetsTable)
    .where(and(eq(sportBetsTable.withdrawToken, token), eq(sportBetsTable.withdrawStatus, "unclaimed")))
    .limit(1);

  if (!bet) { res.status(404).json({ error: "Withdraw token not found or already claimed." }); return; }
  if (bet.status !== "won" || !bet.payoutSats) { res.status(409).json({ error: "Bet is not eligible for withdrawal." }); return; }
  if (Date.now() - bet.createdAt.getTime() > PAYOUT_EXPIRY_MS) { res.status(410).json({ error: "Payout expired after 30 days." }); return; }

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
    .update(sportBetsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(sportBetsTable.withdrawToken, token), eq(sportBetsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!updated) { res.status(409).json({ error: "Payout already claimed." }); return; }

  try {
    await coinosPayInvoice(bolt11, bet.payoutSats);
    logger.info({ sportBetId: bet.id, payoutSats: bet.payoutSats, address }, "Sport payout sent to Lightning address");
    res.json({ ok: true });
  } catch (err) {
    await db.update(sportBetsTable).set({ withdrawStatus: "unclaimed", claimedAt: null }).where(eq(sportBetsTable.id, bet.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, sportBetId: bet.id }, "Pay-to-address Coinos payment failed");
    res.status(502).json({ error: `Payment failed: ${msg}` });
  }
});

export default router;
