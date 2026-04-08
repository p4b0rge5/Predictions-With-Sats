/**
 * Sports Pollers
 *
 * Two independent background loops for sports betting:
 *
 * 1. Payment Poller — polls pending sport_bets for Lightning payment confirmation
 *    (mirrors the existing payment-poller.ts but reads from sport_bets table)
 *
 * 2. Settlement Poller — checks open sport_markets for finished games and settles them
 *    (polls TheSportsDB every 5 minutes for in-progress/finished events)
 */

import { db, sportBetsTable, sportMarketsTable } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import { logger } from "./logger";
import { settleMarket } from "./sports-market";
import { fetchFixtureById } from "./sports";

const PAYMENT_POLL_INTERVAL_MS = 5_000;
// 15-min settlement interval conserves the 100 req/day API-Football free plan budget
const SETTLEMENT_POLL_INTERVAL_MS = 15 * 60 * 1000;
const MAX_POLL_AGE_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// LUD-21 verify URL helper (same logic as payment-poller.ts)
// ---------------------------------------------------------------------------

async function checkLud21(verifyUrl: string): Promise<boolean> {
  try {
    const res = await fetch(verifyUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { settled?: boolean; preimage?: string | null };
    // Require both settled=true AND a non-null preimage to prevent false positives
    return body.settled === true && typeof body.preimage === "string" && body.preimage.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payment poller for sport_bets
// ---------------------------------------------------------------------------

async function pollSportPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_POLL_AGE_MS);

  const pendingBets = await db
    .select()
    .from(sportBetsTable)
    .where(eq(sportBetsTable.status, "pending"));

  for (const bet of pendingBets) {
    if (bet.paymentHash.startsWith("pending_")) continue;

    if (bet.createdAt < cutoff) {
      await db
        .update(sportBetsTable)
        .set({ status: "expired" })
        .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "pending")));
      logger.info({ sportBetId: bet.id }, "Sport bet expired (past poll window)");
      continue;
    }

    let settled = false;
    if (bet.verifyUrl) {
      settled = await checkLud21(bet.verifyUrl);
    }

    if (settled) {
      await db
        .update(sportBetsTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(sportBetsTable.id, bet.id), eq(sportBetsTable.status, "pending")));

      // Update market pool totals
      try {
        const { addToPool } = await import("./sports-market");
        await addToPool(bet.marketId, bet.direction as "home" | "draw" | "away", Number(bet.amountSats));
      } catch (err) {
        logger.warn({ err, sportBetId: bet.id }, "Failed to update sport market pool");
      }

      logger.info({ sportBetId: bet.id }, "Sport bet confirmed via LUD-21");
    }
  }
}

// ---------------------------------------------------------------------------
// Settlement poller — fetch event results via API-Football and settle open markets
// ---------------------------------------------------------------------------

async function pollSportSettlement(): Promise<void> {
  const now = new Date();

  // Only check markets where kickoff has already passed (match may be finished)
  const openMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(and(eq(sportMarketsTable.status, "open"), lt(sportMarketsTable.startsAt, now)));

  if (openMarkets.length === 0) return;

  for (const market of openMarkets) {
    try {
      // Uses API-Football /fixtures?id= endpoint (1 request per market)
      const event = await fetchFixtureById(market.eventId);
      if (!event) continue;

      if (event.status !== "finished") continue;

      const outcome = event.outcome;
      if (!outcome) continue;

      logger.info(
        {
          marketId: market.id,
          eventId:  market.eventId,
          outcome,
          homeScore: event.homeScore,
          awayScore: event.awayScore,
        },
        "Settling sport market",
      );

      await settleMarket(market.id, outcome, event.homeScore, event.awayScore);
    } catch (err) {
      logger.warn({ err, marketId: market.id }, "Sport settlement poller error for market");
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let _paymentTimer: ReturnType<typeof setInterval> | null = null;
let _settlementTimer: ReturnType<typeof setInterval> | null = null;

export function startSportsPollers(): void {
  if (_paymentTimer) return;

  _paymentTimer = setInterval(() => {
    pollSportPayments().catch((err) =>
      logger.warn({ err }, "Sport payment poller error"),
    );
  }, PAYMENT_POLL_INTERVAL_MS);

  _settlementTimer = setInterval(() => {
    pollSportSettlement().catch((err) =>
      logger.warn({ err }, "Sport settlement poller error"),
    );
  }, SETTLEMENT_POLL_INTERVAL_MS);

  // Run settlement immediately on startup
  pollSportSettlement().catch((err) =>
    logger.warn({ err }, "Sport settlement poller startup error"),
  );

  logger.info(
    { paymentMs: PAYMENT_POLL_INTERVAL_MS, settlementMs: SETTLEMENT_POLL_INTERVAL_MS },
    "Sports pollers started",
  );
}

export function stopSportsPollers(): void {
  if (_paymentTimer) { clearInterval(_paymentTimer); _paymentTimer = null; }
  if (_settlementTimer) { clearInterval(_settlementTimer); _settlementTimer = null; }
}
