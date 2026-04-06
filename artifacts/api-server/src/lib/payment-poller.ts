/**
 * Payment Verification Poller
 *
 * Two-tier payment confirmation for pending bets:
 *
 * Tier 1 — LUD-21 verify URL (preferred)
 *   When the LNURL-Pay callback includes a `verify` URL, we poll it every
 *   5 seconds to detect settlement.  Works with any provider that implements
 *   the LUD-21 standard (Alby, etc.).
 *
 * Tier 2 — Alby invoice API fallback
 *   When no verify URL is available (e.g. Wallet of Satoshi), we poll
 *   Alby's invoice API using ALBY_API_TOKEN.  This works when the
 *   LIGHTNING_ADDRESS is an Alby address (user@getalby.com), because the
 *   invoice then lives in Alby's system and is queryable.
 *
 * Recommendation: switch LIGHTNING_ADDRESS to user@getalby.com so both
 * tiers apply and payment confirmation is fully automatic.
 */

import { db, betsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { isAlbyInvoicePaid } from "./alby";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_AGE_MS = 60 * 60 * 1000; // stop polling after 1 hour

// ---------------------------------------------------------------------------
// Tier 1 — LUD-21 verify URL
// ---------------------------------------------------------------------------

interface Lud21VerifyResponse {
  status: "OK" | "ERROR";
  settled: boolean;
  preimage: string | null;
  pr: string;
}

async function checkLud21VerifyUrl(verifyUrl: string): Promise<boolean> {
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

// ---------------------------------------------------------------------------
// Main poll loop
// ---------------------------------------------------------------------------

async function pollPendingBets(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_POLL_AGE_MS);

  const pendingBets = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.status, "pending"));

  if (pendingBets.length === 0) return;

  for (const bet of pendingBets) {
    // Skip placeholder bets that haven't received an invoice yet
    if (bet.paymentHash.startsWith("pending_")) continue;

    // Expire bets older than the poll window
    if (bet.createdAt < cutoff) {
      await db
        .update(betsTable)
        .set({ status: "expired" })
        .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "pending")));
      logger.info({ betId: bet.id }, "Bet expired (past poll window)");
      continue;
    }

    let settled = false;

    // Tier 1: LUD-21 verify URL (if provider supports it)
    if (bet.verifyUrl) {
      settled = await checkLud21VerifyUrl(bet.verifyUrl);
      if (settled) {
        logger.info({ betId: bet.id }, "Bet confirmed via LUD-21 verify URL");
      }
    }

    // Tier 2: Alby invoice API (works when LIGHTNING_ADDRESS is @getalby.com)
    if (!settled) {
      settled = await isAlbyInvoicePaid(bet.paymentHash);
      if (settled) {
        logger.info({ betId: bet.id }, "Bet confirmed via Alby invoice API");
      }
    }

    if (settled) {
      await db
        .update(betsTable)
        .set({ status: "paid", paidAt: new Date() })
        .where(and(eq(betsTable.id, bet.id), eq(betsTable.status, "pending")));
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startPaymentPoller(): void {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    pollPendingBets().catch((err) =>
      logger.warn({ err }, "Payment poller error"),
    );
  }, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Payment poller started (LUD-21 + Alby API)");
}

export function stopPaymentPoller(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}
