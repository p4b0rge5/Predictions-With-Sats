/**
 * Weather Pollers
 *
 * 1. Payment Poller — confirms pending weather_bets via LUD-21 verifyUrl
 * 2. Settlement Poller — runs daily to settle past-date markets + creates tomorrow's markets
 */

import { db, weatherBetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { runWeatherSettlementCycle, addToWeatherPool } from "./weather";

const PAYMENT_POLL_INTERVAL_MS = 5_000;
const SETTLEMENT_POLL_INTERVAL_MS = 60 * 60 * 1000; // 1h
const MAX_POLL_AGE_MS = 24 * 60 * 60 * 1000; // 24h (weather bets can sit longer)

// ---------------------------------------------------------------------------
// LUD-21 check
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
    // (e.g. Coinos returns settled=true with preimage=null for 0-sat/invalid invoices)
    return body.settled === true && typeof body.preimage === "string" && body.preimage.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payment poller
// ---------------------------------------------------------------------------

async function pollWeatherPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_POLL_AGE_MS);

  const pendingBets = await db
    .select()
    .from(weatherBetsTable)
    .where(eq(weatherBetsTable.status, "pending"));

  for (const bet of pendingBets) {
    if (bet.createdAt < cutoff) {
      await db
        .update(weatherBetsTable)
        .set({ status: "expired" })
        .where(and(eq(weatherBetsTable.id, bet.id), eq(weatherBetsTable.status, "pending")));
      logger.info({ weatherBetId: bet.id }, "Weather bet expired");
      continue;
    }

    if (!bet.verifyUrl) continue;

    const paid = await checkLud21(bet.verifyUrl);
    if (!paid) continue;

    await db
      .update(weatherBetsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(weatherBetsTable.id, bet.id), eq(weatherBetsTable.status, "pending")));

    try {
      await addToWeatherPool(bet.marketId, bet.direction as "yes" | "no", bet.amountSats);
    } catch (err) {
      logger.warn({ err, weatherBetId: bet.id }, "Failed to add to weather pool");
    }

    logger.info({ weatherBetId: bet.id }, "Weather bet confirmed via LUD-21");
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let paymentTimer: ReturnType<typeof setInterval> | null = null;
let settlementTimer: ReturnType<typeof setInterval> | null = null;

export function startWeatherPollers(): void {
  if (paymentTimer) return;

  paymentTimer = setInterval(() => {
    pollWeatherPayments().catch((err) =>
      logger.warn({ err }, "Weather payment poller error"),
    );
  }, PAYMENT_POLL_INTERVAL_MS);

  settlementTimer = setInterval(() => {
    runWeatherSettlementCycle().catch((err) =>
      logger.warn({ err }, "Weather settlement poller error"),
    );
  }, SETTLEMENT_POLL_INTERVAL_MS);

  // Run settlement on startup
  runWeatherSettlementCycle().catch((err) =>
    logger.warn({ err }, "Weather settlement startup error"),
  );

  logger.info("Weather pollers started");
}

export function stopWeatherPollers(): void {
  if (paymentTimer) { clearInterval(paymentTimer); paymentTimer = null; }
  if (settlementTimer) { clearInterval(settlementTimer); settlementTimer = null; }
}
