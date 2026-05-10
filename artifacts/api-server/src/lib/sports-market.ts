/**
 * Sports Market Engine
 *
 * Handles creation, lookup, and settlement of sport prediction markets.
 * Completely isolated from the BTC prediction logic (market.ts).
 *
 * Three-way market: HOME | DRAW | AWAY
 * Settlement math:
 *   - If 2+ outcomes have liquidity: the total pool (home + draw + away sats)
 *     minus 2% house fee is distributed proportionally to winners.
 *   - If only 1 outcome has liquidity (no opposing bets): all bettors receive
 *     their stake back as a REFUND with a reduced 0.5% fee.
 *   - If the winning outcome had zero bets: same refund path — everyone gets
 *     their stake back minus 0.5%.
 *   - DRAW is a real betting outcome — DRAW bettors win when the final score is a draw.
 *   - Minimum payout: 1 sat
 */

import { randomUUID } from "node:crypto";
import { db, sportMarketsTable, sportBetsTable } from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { logger } from "./logger";
import type { SportEvent } from "./sports";
import { publishSportMarketCreated, publishSportMarketSettled } from "./nostr-publisher";

const HOUSE_FEE = 0.02;
const NO_LIQUIDITY_REFUND_FEE = 0.005;

export type SportDirection = "home" | "draw" | "away";

// ---------------------------------------------------------------------------
// Market lookup / creation
// ---------------------------------------------------------------------------

export async function findOrCreateMarket(event: SportEvent) {
  const existing = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.eventId, event.id))
    .limit(1);

  if (existing[0]) return existing[0];

  const [market] = await db
    .insert(sportMarketsTable)
    .values({
      eventId: event.id,
      eventName: event.event,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      homeBadge: event.homeBadge,
      awayBadge: event.awayBadge,
      leagueLogo: event.leagueLogo,
      league: event.league,
      sport: event.sport,
      startsAt: new Date(event.startsAt),
      status: "open",
    })
    .returning();

  logger.info({ marketId: market.id, eventId: event.id }, "Sport market created");

  // Publish to Nostr for promotion (fire-and-forget, never blocks creation)
  publishSportMarketCreated(market).catch((err) =>
    logger.warn({ err, marketId: market.id }, "Nostr publish failed for new market"),
  );

  return market;
}

export async function getOpenMarkets() {
  return db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.status, "open"));
}

export async function getMarketByEventId(eventId: string) {
  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.eventId, eventId))
    .limit(1);
  return market ?? null;
}

export async function markMarketFinished(marketId: number, finishedAt = new Date()) {
  await db
    .update(sportMarketsTable)
    .set({ finishedAt })
    .where(and(eq(sportMarketsTable.id, marketId), isNull(sportMarketsTable.finishedAt)));
}

// ---------------------------------------------------------------------------
// Pool accounting — called after a bet is confirmed as paid
// ---------------------------------------------------------------------------

export async function addToPool(marketId: number, direction: SportDirection, amountSats: number) {
  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.id, marketId))
    .limit(1);

  if (!market) return;

  if (direction === "home") {
    await db
      .update(sportMarketsTable)
      .set({ totalHomeSats: market.totalHomeSats + amountSats })
      .where(eq(sportMarketsTable.id, marketId));
  } else if (direction === "draw") {
    await db
      .update(sportMarketsTable)
      .set({ totalDrawSats: market.totalDrawSats + amountSats })
      .where(eq(sportMarketsTable.id, marketId));
  } else {
    await db
      .update(sportMarketsTable)
      .set({ totalAwaySats: market.totalAwaySats + amountSats })
      .where(eq(sportMarketsTable.id, marketId));
  }
}

// ---------------------------------------------------------------------------
// Settlement — three-way (HOME | DRAW | AWAY)
// ---------------------------------------------------------------------------

// ── Early refund: no opposing liquidity ────────────────────────────────────
// When betting closes and all paid bets are on a single outcome, there's no
// meaningful contest. Refund everyone immediately — no need to wait for the
// actual game result. Returns true when an early refund was executed.

export async function tryEarlyRefund(marketId: number): Promise<boolean> {
  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(and(eq(sportMarketsTable.id, marketId), eq(sportMarketsTable.status, "open")))
    .limit(1);

  if (!market) return false;

  const paidBets = await db
    .select()
    .from(sportBetsTable)
    .where(and(eq(sportBetsTable.marketId, marketId), eq(sportBetsTable.status, "paid")));

  if (paidBets.length === 0) return false;

  const paidOutcomeCount = new Set(paidBets.map((b) => b.direction)).size;
  if (paidOutcomeCount > 1) return false;

  // All bets on one outcome — refund immediately
  for (const bet of paidBets) {
    const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
    const token = randomUUID();
    await db
      .update(sportBetsTable)
      .set({
        status: "refunded",
        payoutSats: refundSats,
        withdrawToken: token,
        withdrawStatus: "unclaimed",
      })
      .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "paid")));
  }

  await db
    .update(sportMarketsTable)
    .set({
      status: "settled",
      outcome: "no_liquidity",
      finishedAt: market.finishedAt ?? new Date(),
      settledAt: new Date(),
    })
    .where(eq(sportMarketsTable.id, marketId));

  logger.info(
    { marketId, refundedBets: paidBets.length, refundFeeRate: NO_LIQUIDITY_REFUND_FEE },
    "Sport market — early refund (single outcome, no opposing liquidity)",
  );
  return true;
}

export async function settleMarket(
  marketId: number,
  outcome: SportDirection,
  homeScore: number | null,
  awayScore: number | null,
) {
  // If market was already settled by early refund, skip
  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.id, marketId))
    .limit(1);

  if (!market || market.status !== "open") {
    logger.warn({ marketId }, "Sport market not found or already settled");
    return;
  }

  const paidBets = await db
    .select()
    .from(sportBetsTable)
    .where(and(eq(sportBetsTable.marketId, marketId), eq(sportBetsTable.status, "paid")));

  if (paidBets.length === 0) {
    await db
      .update(sportMarketsTable)
      .set({
        status: "settled",
        outcome,
        homeScore,
        awayScore,
        finishedAt: market.finishedAt ?? new Date(),
        settledAt: new Date(),
      })
      .where(eq(sportMarketsTable.id, marketId));
    logger.info({ marketId, outcome }, "Sport market settled (no paid bets)");
    return;
  }

  const winners = paidBets.filter((b) => b.direction === outcome);
  const paidOutcomeCount = new Set(paidBets.map((b) => b.direction)).size;

  // ── Refund path: no opposing liquidity ───────────────────────────────────
  // Triggered when:
  //   1) The winning outcome had zero bets  (nobody picked the right result)
  //   2) All bets landed on a single outcome (no opposing liquidity)
  // In both cases, everyone gets their stake back minus 0.5 % refund fee.
  //
  // Normal settlement only when 2+ distinct outcomes have liquidity AND
  // the winning outcome actually has bets.

  if (winners.length === 0 || paidOutcomeCount <= 1) {
    // Single-side liquidity — refund all bets
    for (const bet of paidBets) {
      const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
      const token = randomUUID();
      await db
        .update(sportBetsTable)
        .set({
          status: "refunded",
          payoutSats: refundSats,
          withdrawToken: token,
          withdrawStatus: "unclaimed",
        })
        .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "paid")));
    }
    logger.info(
      { marketId, outcome, refundedBets: paidBets.length, refundFeeRate: NO_LIQUIDITY_REFUND_FEE },
      "Sport market settled — no opposing liquidity, refund prepared",
    );
  } else {
    // ── Normal settlement: winner takes pool, losers lose ──────────────────
    const totalPool = market.totalHomeSats + market.totalDrawSats + market.totalAwaySats;
    const netPool = Math.floor(totalPool * (1 - HOUSE_FEE));

    const losers = paidBets.filter((b) => b.direction !== outcome);
    const totalWinnerStake = winners.reduce((s, b) => s + Number(b.amountSats), 0);

    // Mark losers
    if (losers.length > 0) {
      await db
        .update(sportBetsTable)
        .set({ status: "lost", payoutSats: 0 })
        .where(
          and(
            eq(sportBetsTable.marketId, marketId),
            inArray(sportBetsTable.id, losers.map((b) => b.id)),
          ),
        );
    }

    // Distribute net pool proportionally to winners
    for (const bet of winners) {
      const share = Number(bet.amountSats) / totalWinnerStake;
      const payoutSats = Math.max(1, Math.floor(netPool * share));
      const token = randomUUID();
      await db
        .update(sportBetsTable)
        .set({
          status: "won",
          payoutSats,
          withdrawToken: token,
          withdrawStatus: "unclaimed",
        })
        .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "paid")));
    }
    logger.info(
      { marketId, outcome, winners: winners.length, totalPool, netPool },
      "Sport market settled — winners paid",
    );
  }

  await db
    .update(sportMarketsTable)
    .set({
      status: "settled",
      outcome,
      homeScore,
      awayScore,
      finishedAt: market.finishedAt ?? new Date(),
      settledAt: new Date(),
    })
    .where(eq(sportMarketsTable.id, marketId));

  // Publish settlement to Nostr for promotion (fire-and-forget)
  publishSportMarketSettled({
    id: market.id,
    homeTeam: market.homeTeam,
    awayTeam: market.awayTeam,
    league: market.league,
    sport: market.sport,
    homeScore,
    awayScore,
    homeSats: market.totalHomeSats,
    drawSats: market.totalDrawSats,
    awaySats: market.totalAwaySats,
    startsAt: market.startsAt,
    homeBadge: market.homeBadge ?? undefined,
    awayBadge: market.awayBadge ?? undefined,
    leagueLogo: market.leagueLogo ?? undefined,
    outcome,
  }).catch((err) =>
    logger.warn({ err, marketId }, "Nostr publish failed for settlement"),
  );
}
