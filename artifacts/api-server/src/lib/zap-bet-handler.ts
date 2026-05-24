/**
 * Zap-to-Bet Handler
 *
 * Bridges the gap between NIP-57 zap payments and PWSats bets.
 *
 * When a zap payment is confirmed (via webhook or LUD-21 verify), this module
 * is notified and creates the corresponding bet in the database.
 *
 * Mapping: zap eventId (e tag) → nostr event id → market id
 * (The market post includes the market id as a custom tag: ["market", "123"])
 */

import { db, sportBetsTable, sportMarketsTable, weatherBetsTable, weatherMarketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { pendingZaps } from "../routes/lnurl-zap";

// ---------------------------------------------------------------------------
// eventId → marketId mapping
// ---------------------------------------------------------------------------

// Cache: nostr eventId → { marketId, marketType }
const eventIdToMarket = new Map<string, { marketId: number; marketType: "sport" | "sport_poly" | "weather" }>();

/**
 * Register a mapping from nostr event id to market id.
 * Called after publishing a market post.
 */
export function registerZappableMarket(
  nostrEventId: string,
  marketId: number,
  marketType: "sport" | "sport_poly" | "weather" = "sport",
): void {
  eventIdToMarket.set(nostrEventId, { marketId, marketType });
  logger.info(
    { eventId: nostrEventId, marketId, marketType },
    "Registered zappable market",
  );
}

/**
 * Look up market from nostr event id.
 */
export function lookupMarketByEventId(eventId: string):
  { marketId: number; marketType: "sport" | "sport_poly" | "weather" } | null {
  return eventIdToMarket.get(eventId) || null;
}

// ---------------------------------------------------------------------------
// Handle confirmed zap payment → create bet
// ---------------------------------------------------------------------------

export interface ZapBetResult {
  success: boolean;
  betId?: number;
  error?: string;
}

export async function handleZapPayment(paymentHash: string, bolt11: string): Promise<ZapBetResult> {
  const pending = pendingZaps.get(paymentHash);
  if (!pending) {
    logger.info({ paymentHash }, "Payment confirmed but no pending zap found — might be a regular bet");
    return { success: false, error: "No pending zap found" };
  }

  const { eventId, outcome, amountSats, zapRequestId } = pending;

  // Look up which market this zap was for
  const marketInfo = lookupMarketByEventId(eventId);
  if (!marketInfo) {
    logger.warn(
      { eventId, paymentHash },
      "Zap payment confirmed but no market found for event id",
    );
    pendingZaps.delete(paymentHash);
    return { success: false, error: "Market not found for zap event" };
  }

  // Map outcome to direction
  const direction = normalizeOutcome(outcome, marketInfo.marketType);
  if (!direction) {
    logger.warn({ outcome, marketInfo }, "Invalid outcome for market type");
    pendingZaps.delete(paymentHash);
    return { success: false, error: "Invalid outcome" };
  }

  try {
    if (marketInfo.marketType === "sport") {
      const betId = await createSportBet(
        marketInfo.marketId,
        direction as "home" | "draw" | "away",
        amountSats,
        paymentHash,
        bolt11,
        zapRequestId,
      );
      pendingZaps.delete(paymentHash);
      return { success: true, betId };
    } else if (marketInfo.marketType === "weather") {
      const betId = await createWeatherBet(
        marketInfo.marketId,
        direction as "yes" | "no",
        amountSats,
        paymentHash,
        bolt11,
        zapRequestId,
      );
      pendingZaps.delete(paymentHash);
      return { success: true, betId };
    }
    // sport_poly: for now, fall back to sport bets
    const betId = await createSportBet(
      marketInfo.marketId,
      direction as "home" | "draw" | "away",
      amountSats,
      paymentHash,
      bolt11,
      zapRequestId,
    );
    pendingZaps.delete(paymentHash);
    return { success: true, betId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, paymentHash, eventId }, "Failed to create zap bet");
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Outcome normalization
// ---------------------------------------------------------------------------

function normalizeOutcome(
  outcome: string | null,
  marketType: "sport" | "sport_poly" | "weather",
): "home" | "draw" | "away" | "yes" | "no" | null {
  if (!outcome) return null;
  const lower = outcome.toLowerCase();

  if (marketType === "weather") {
    return lower === "yes" ? "yes" : lower === "no" ? "no" : null;
  }
  // sport and sport_poly
  return (
    lower === "home" ? "home" :
    lower === "draw" ? "draw" :
    lower === "away" ? "away" :
    null
  );
}

// ---------------------------------------------------------------------------
// Bet creation helpers
// ---------------------------------------------------------------------------

async function createSportBet(
  marketId: number,
  direction: "home" | "draw" | "away",
  amountSats: number,
  paymentHash: string,
  bolt11: string,
  zapRequestId: string,
): Promise<number> {
  const result = await db
    .insert(sportBetsTable)
    .values({
      marketId,
      direction,
      amountSats,
      paymentHash,
      paymentRequest: bolt11,
      status: "paid",
      paidAt: new Date(),
    })
    .returning();

  const betId = result[0]?.id;
  logger.info({ betId, marketId, direction, amountSats }, "Zap bet created (sport)");
  return betId!;
}

async function createWeatherBet(
  marketId: number,
  direction: "yes" | "no",
  amountSats: number,
  paymentHash: string,
  bolt11: string,
  zapRequestId: string,
): Promise<number> {
  const result = await db
    .insert(weatherBetsTable)
    .values({
      marketId,
      direction,
      amountSats,
      paymentHash,
      paymentRequest: bolt11,
      status: "paid",
      paidAt: new Date(),
    })
    .returning();

  const betId = result[0]?.id;
  logger.info({ betId, marketId, direction, amountSats }, "Zap bet created (weather)");
  return betId!;
}

// ---------------------------------------------------------------------------
// Cleanup stale mappings
// ---------------------------------------------------------------------------

setInterval(() => {
  const before = eventIdToMarket.size;
  for (const [key] of eventIdToMarket) {
    if (!pendingZaps.has(key)) {
      // Check if any pending zap references this eventId
      let hasActive = false;
      for (const [, pz] of pendingZaps) {
        if (pz.eventId === key) { hasActive = true; break; }
      }
      if (!hasActive) {
        eventIdToMarket.delete(key);
      }
    }
  }
  const after = eventIdToMarket.size;
  if (before !== after) {
    logger.info({ before, after }, "Cleaned up stale event→market mappings");
  }
}, 60 * 60 * 1000); // every hour
