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
import { markMarketFinished, settleMarket } from "./sports-market";
import { getSportsEvents, fetchFixtureById } from "./sports";
import { getNbaEvents, fetchNbaGameById } from "./nba";
import { getNflEvents, fetchNflGameById } from "./nfl";
import { getMlbEvents, fetchMlbGameById } from "./mlb";
import { getMmaEvents, fetchMmaFightById } from "./mma";
import { getRugbyEvents, fetchRugbyGameById } from "./rugby";

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

// Expected game duration per sport (kickoff → expected finish).
// Used to decide when to force-refresh the API cache and do direct lookups.
function getExpectedDurationMs(eventId: string): number {
  if (eventId.startsWith("nfl_")) return 240 * 60 * 1000; // NFL: up to 4h with OT
  if (eventId.startsWith("nba_")) return 150 * 60 * 1000; // NBA: ~2.5h with OT
  if (eventId.startsWith("mlb_")) return 270 * 60 * 1000; // MLB: up to 4.5h with extra innings
  if (eventId.startsWith("mma_"))   return 360 * 60 * 1000; // MMA: up to 6h with prelims + main card
  if (eventId.startsWith("rugby_")) return 150 * 60 * 1000; // Rugby: 80 min + stoppages + potential extra time
  return 110 * 60 * 1000;                                    // Soccer: ~110 min
}

type SportLoaderResult = Awaited<ReturnType<typeof getSportsEvents>>;
type MarketSport = "football" | "nba" | "nfl" | "mlb" | "mma" | "rugby";

function sportFromEventId(eventId: string): MarketSport {
  if (eventId.startsWith("nba_")) return "nba";
  if (eventId.startsWith("nfl_")) return "nfl";
  if (eventId.startsWith("mlb_")) return "mlb";
  if (eventId.startsWith("mma_")) return "mma";
  if (eventId.startsWith("rugby_")) return "rugby";
  return "football";
}

async function loadSettlementEvents(
  sport: MarketSport,
  forceRefresh: boolean,
): Promise<SportLoaderResult> {
  if (sport === "nba") return getNbaEvents(forceRefresh);
  if (sport === "nfl") return getNflEvents(forceRefresh);
  if (sport === "mlb") return getMlbEvents(forceRefresh);
  if (sport === "mma") return getMmaEvents(forceRefresh);
  if (sport === "rugby") return getRugbyEvents(forceRefresh);
  return getSportsEvents(forceRefresh);
}

async function pollSportSettlement(): Promise<void> {
  const now = new Date();

  // Only check markets where kickoff has already passed (match may be finished)
  const openMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(and(eq(sportMarketsTable.status, "open"), lt(sportMarketsTable.startsAt, now)));

  if (openMarkets.length === 0) return;

  logger.info({ count: openMarkets.length }, "Settlement poller: checking open sport markets");

  const nowMs = Date.now();
  const sportsToLoad = new Map<MarketSport, boolean>();
  for (const market of openMarkets) {
    const sport = sportFromEventId(market.eventId);
    const isPastDue = nowMs - new Date(market.startsAt).getTime() > getExpectedDurationMs(market.eventId);
    sportsToLoad.set(sport, (sportsToLoad.get(sport) ?? false) || isPastDue);
  }

  const settledEventsBySport = new Map<MarketSport, SportLoaderResult>();
  await Promise.all(
    [...sportsToLoad.entries()].map(async ([sport, shouldForceRefresh]) => {
      const events = await loadSettlementEvents(sport, shouldForceRefresh);
      settledEventsBySport.set(sport, events);
    }),
  );

  const allFinished = [...settledEventsBySport.values()].flatMap((events) => events.finished);
  const finishedById = new Map(allFinished.map((e) => [e.id, e]));

  for (const market of openMarkets) {
    try {
      let event = finishedById.get(market.eventId);

      // If not in the cache finished list but match should be done, do a direct API lookup
      if (!event || event.status !== "finished") {
        const kickoffMs = new Date(market.startsAt).getTime();
        const isOverdue = nowMs - kickoffMs > getExpectedDurationMs(market.eventId);
        if (isOverdue) {
          logger.info(
            { marketId: market.id, eventId: market.eventId },
            "Market past expected duration — doing direct API lookup",
          );
          const isNba = market.eventId.startsWith("nba_");
          const isNfl = market.eventId.startsWith("nfl_");
          const isMlb = market.eventId.startsWith("mlb_");
          const isMma   = market.eventId.startsWith("mma_");
          const isRugby = market.eventId.startsWith("rugby_");
          const fetched = isNfl
            ? await fetchNflGameById(market.eventId)
            : isMlb
              ? await fetchMlbGameById(market.eventId)
              : isMma
                ? await fetchMmaFightById(market.eventId)
                : isRugby
                  ? await fetchRugbyGameById(market.eventId)
                  : isNba
                    ? await fetchNbaGameById(market.eventId)
                    : await fetchFixtureById(market.eventId);
          if (fetched) event = fetched;
        }
      }

      // Still not finished — match in progress or not yet available
      if (!event || event.status !== "finished") {
        logger.info(
          { marketId: market.id, eventId: market.eventId, status: event?.status ?? "not_found" },
          "Market event not yet finished — skipping settlement",
        );
        continue;
      }

      const outcome = event.outcome;
      if (!outcome) {
        logger.warn(
          { marketId: market.id, eventId: market.eventId, homeScore: event.homeScore, awayScore: event.awayScore },
          "Event finished but outcome is null — skipping",
        );
        continue;
      }

      await markMarketFinished(market.id);

      logger.info(
        {
          marketId:  market.id,
          eventId:   market.eventId,
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
