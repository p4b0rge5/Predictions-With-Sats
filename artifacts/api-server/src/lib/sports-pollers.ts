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

const PAYMENT_POLL_INTERVAL_MS = 5_000;
const SETTLEMENT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const MAX_POLL_AGE_MS = 60 * 60 * 1000;
const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

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
// Settlement poller — fetch event results and settle open markets
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchEventById(eventId: string): Promise<any | null> {
  try {
    const url = `${SPORTSDB_BASE}/lookupevent.php?id=${eventId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as { events?: any[] };
    return data.events?.[0] ?? null;
  } catch {
    return null;
  }
}

function parseStatus(strStatus: string): "upcoming" | "live" | "finished" {
  const s = (strStatus ?? "").toLowerCase();
  if (s === "match finished" || s === "ft" || s === "aet" || s === "pen") return "finished";
  if (s === "in progress" || s === "1h" || s === "2h" || s === "ht") return "live";
  return "upcoming";
}

function parseOutcome(home: number | null, away: number | null): "home" | "away" | "draw" | null {
  if (home === null || away === null) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

async function pollSportSettlement(): Promise<void> {
  const now = new Date();

  const openMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(and(eq(sportMarketsTable.status, "open"), lt(sportMarketsTable.startsAt, now)));

  if (openMarkets.length === 0) return;

  for (const market of openMarkets) {
    try {
      const event = await fetchEventById(market.eventId);
      if (!event) continue;

      const homeScore =
        event.intHomeScore !== null && event.intHomeScore !== "" ? Number(event.intHomeScore) : null;
      const awayScore =
        event.intAwayScore !== null && event.intAwayScore !== "" ? Number(event.intAwayScore) : null;

      const status = parseStatus(event.strStatus ?? "");

      if (status !== "finished") continue;

      const outcome = parseOutcome(homeScore, awayScore);
      if (!outcome) continue;

      logger.info(
        { marketId: market.id, eventId: market.eventId, outcome, homeScore, awayScore },
        "Settling sport market",
      );

      await settleMarket(market.id, outcome, homeScore, awayScore);
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
