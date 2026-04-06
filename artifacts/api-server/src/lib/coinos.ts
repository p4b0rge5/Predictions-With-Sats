/**
 * Coinos.io API client — used for outbound Lightning payments (winner payouts).
 *
 * Authentication: Coinos.io protects /api/login with hCaptcha, which blocks
 * server-to-server calls. Instead, we accept a pre-obtained JWT token stored
 * as the COINOS_JWT_TOKEN secret.
 *
 * How to get your token:
 *   1. Log into https://coinos.io in your browser
 *   2. Open DevTools → Application → Local Storage → https://coinos.io
 *   3. Copy the value of the "token" key
 *   4. Add it as the COINOS_JWT_TOKEN secret in Replit
 *
 * The token is long-lived (weeks). If payouts start failing, refresh it by
 * repeating the steps above and updating the secret.
 */

import { logger } from "./logger";

const COINOS_BASE = "https://coinos.io/api";

async function getCoinosToken(): Promise<string> {
  const jwt = process.env.COINOS_JWT_TOKEN;

  if (jwt) {
    return jwt;
  }

  throw new Error(
    "COINOS_JWT_TOKEN secret is required for winner payouts. " +
    "Log into coinos.io in your browser → DevTools → Application → Local Storage → copy the 'token' value → add it as COINOS_JWT_TOKEN in Replit Secrets.",
  );
}

/**
 * Pay a Lightning invoice from the Coinos account.
 * Used to pay out winning bets via LNURL-Withdraw.
 */
export async function coinosPayInvoice(bolt11: string, amountSats: number): Promise<void> {
  const token = await getCoinosToken();

  const payBody = {
    hash: bolt11,
    amount: amountSats,
    type: "lightning",
  };

  const res = await fetch(`${COINOS_BASE}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payBody),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");

    // If 401, token might be stale — clear cache and let caller retry once
    if (res.status === 401) {
      _jwtToken = null;
      _tokenFetchedAt = 0;
    }

    throw new Error(`Coinos payment failed (${res.status}): ${text}`);
  }

  const result = await res.json().catch(() => ({})) as Record<string, unknown>;
  logger.info({ amountSats, resultKeys: Object.keys(result) }, "Coinos Lightning payment sent");
}
