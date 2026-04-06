/**
 * LUD-21 Payment Verification Poller
 *
 * Polls the `verify` URL included in a LNURL-Pay callback response to detect
 * when a Lightning invoice has been settled.  Runs every 5 seconds for each
 * pending bet that has a verifyUrl stored.
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/21.md
 *
 * If the Lightning Address provider does NOT return a verify URL (e.g. some
 * custodial wallets), payment confirmation falls back to the Alby webhook.
 */

import { db, betsTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_AGE_MS = 60 * 60 * 1000; // stop polling after 1 hour

interface Lud21VerifyResponse {
  status: "OK" | "ERROR";
  settled: boolean;
  preimage: string | null;
  pr: string;
}

async function checkVerifyUrl(verifyUrl: string): Promise<boolean> {
  try {
    const res = await fetch(verifyUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const body = await res.json() as Lud21VerifyResponse;
    return body.settled === true;
  } catch {
    return false;
  }
}

async function pollPendingVerifications(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_POLL_AGE_MS);

  const pendingBets = await db
    .select()
    .from(betsTable)
    .where(
      and(
        eq(betsTable.status, "pending"),
        isNotNull(betsTable.verifyUrl),
      ),
    );

  for (const bet of pendingBets) {
    if (!bet.verifyUrl) continue;

    // Skip bets created more than 1 hour ago (invoice likely expired)
    if (bet.createdAt < cutoff) {
      await db
        .update(betsTable)
        .set({ status: "expired" })
        .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "pending")));
      logger.info({ betId: bet.id }, "Bet expired (past poll window)");
      continue;
    }

    const settled = await checkVerifyUrl(bet.verifyUrl);
    if (settled) {
      await db
        .update(betsTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "pending")));
      logger.info(
        { betId: bet.id, paymentHash: bet.paymentHash },
        "Bet confirmed via LUD-21 verify URL",
      );
    }
  }
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPaymentPoller(): void {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    pollPendingVerifications().catch((err) =>
      logger.warn({ err }, "Payment poller error"),
    );
  }, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Payment poller started");
}

export function stopPaymentPoller(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
