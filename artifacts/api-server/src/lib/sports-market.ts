/**
 * Sports Market Engine
 *
 * Handles creation, lookup, and settlement of sport prediction markets.
 * Completely isolated from the BTC prediction logic (market.ts).
 *
 * Three-way market: HOME | DRAW | AWAY
 * Settlement math:
 *   - The total pool (home + draw + away sats) minus 2% house fee is distributed
 *     proportionally to winners.
 *   - DRAW is a real betting outcome — DRAW bettors win when the final score is a draw.
 *   - Minimum payout: 1 sat
 */

import { randomUUID } from "node:crypto";
import { db, sportMarketsTable, sportBetsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import type { SportEvent } from "./sports";

const HOUSE_FEE = 0.02;

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
      league: event.league,
      sport: event.sport,
      startsAt: new Date(event.startsAt),
      status: "open",
    })
    .returning();

  logger.info({ marketId: market.id, eventId: event.id }, "Sport market created");
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

export async function settleMarket(
  marketId: number,
  outcome: SportDirection,
  homeScore: number | null,
  awayScore: number | null,
) {
  const [market] = await db
    .select()
    .from(sportMarketsTable)
    .where(and(eq(sportMarketsTable.id, marketId), eq(sportMarketsTable.status, "open")))
    .limit(1);

  if (!market) {
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
      .set({ status: "settled", outcome, homeScore, awayScore, settledAt: new Date() })
      .where(eq(sportMarketsTable.id, marketId));
    logger.info({ marketId, outcome }, "Sport market settled (no paid bets)");
    return;
  }

  const totalPool = market.totalHomeSats + market.totalDrawSats + market.totalAwaySats;
  const netPool = Math.floor(totalPool * (1 - HOUSE_FEE));

  const winners = paidBets.filter((b) => b.direction === outcome);
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

  if (winners.length === 0 || totalWinnerStake === 0) {
    // No one bet on the winning outcome — house keeps pool
    await db
      .update(sportBetsTable)
      .set({ status: "lost", payoutSats: 0 })
      .where(and(eq(sportBetsTable.marketId, marketId), eq(sportBetsTable.status, "paid")));
    logger.info({ marketId, outcome }, "Sport market settled — no winners, house keeps pool");
  } else {
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
    .set({ status: "settled", outcome, homeScore, awayScore, settledAt: new Date() })
    .where(eq(sportMarketsTable.id, marketId));
}
