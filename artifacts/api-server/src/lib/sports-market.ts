/**
 * Sports Market Engine
 *
 * Handles creation, lookup, and settlement of sport prediction markets.
 * Completely isolated from the BTC prediction logic (market.ts).
 *
 * Settlement math (mirrors BTC market logic):
 *   - Winners split the total pool (home + away sats) minus 2% house fee
 *   - DRAW: all paid bettors receive 98% refund
 *   - Minimum payout: 1 sat
 */

import { randomUUID } from "node:crypto";
import { db, sportMarketsTable, sportBetsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import type { SportEvent } from "./sports";

const HOUSE_FEE = 0.02;

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

export async function addToPool(marketId: number, direction: "home" | "away", amountSats: number) {
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
  } else {
    await db
      .update(sportMarketsTable)
      .set({ totalAwaySats: market.totalAwaySats + amountSats })
      .where(eq(sportMarketsTable.id, marketId));
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export async function settleMarket(
  marketId: number,
  outcome: "home" | "away" | "draw",
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

  const totalPool = market.totalHomeSats + market.totalAwaySats;
  const netPool = Math.floor(totalPool * (1 - HOUSE_FEE));

  if (outcome === "draw") {
    // Everyone gets 98% refund
    for (const bet of paidBets) {
      const refundSats = Math.max(1, Math.floor(bet.amountSats * (1 - HOUSE_FEE)));
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
    logger.info({ marketId, paidBets: paidBets.length }, "Sport market settled — DRAW, all refunded");
  } else {
    const winners = paidBets.filter((b) => b.direction === outcome);
    const losers = paidBets.filter((b) => b.direction !== outcome);
    const totalWinnerStake = winners.reduce((s, b) => s + b.amountSats, 0);

    // Mark losers
    if (losers.length > 0) {
      await db
        .update(sportBetsTable)
        .set({ status: "lost", payoutSats: 0 })
        .where(
          and(
            eq(sportBetsTable.marketId, marketId),
            inArray(
              sportBetsTable.id,
              losers.map((b) => b.id),
            ),
          ),
        );
    }

    if (winners.length === 0 || totalWinnerStake === 0) {
      // No winners — mark all as lost (house keeps pool)
      await db
        .update(sportBetsTable)
        .set({ status: "lost", payoutSats: 0 })
        .where(and(eq(sportBetsTable.marketId, marketId), eq(sportBetsTable.status, "paid")));
    } else {
      // Distribute pool to winners proportionally
      for (const bet of winners) {
        const share = bet.amountSats / totalWinnerStake;
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
  }

  await db
    .update(sportMarketsTable)
    .set({ status: "settled", outcome, homeScore, awayScore, settledAt: new Date() })
    .where(eq(sportMarketsTable.id, marketId));
}
