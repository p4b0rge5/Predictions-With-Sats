/**
 * Coinos.io API client — used for outbound Lightning payments (winner payouts).
 *
 * Authentication: POST /api/login with username + password → JWT token.
 * Pay invoice:    POST /api/payments with the JWT and the bolt11 invoice.
 *
 * Required secrets: COINOS_USERNAME, COINOS_PASSWORD
 * These are the login credentials for the Coinos account that receives bets
 * (e.g. p4b0rge55@coinos.io → username: p4b0rge55).
 */

import { logger } from "./logger";

const COINOS_BASE = "https://coinos.io/api";

let _jwtToken: string | null = null;
let _tokenFetchedAt = 0;
const TOKEN_TTL_MS = 55 * 60 * 1000; // refresh every 55 minutes

async function getCoinosToken(): Promise<string> {
  const now = Date.now();
  if (_jwtToken && now - _tokenFetchedAt < TOKEN_TTL_MS) {
    return _jwtToken;
  }

  const username = process.env.COINOS_USERNAME;
  const password = process.env.COINOS_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "COINOS_USERNAME and COINOS_PASSWORD secrets are required for winner payouts. " +
      "Set them in Replit Secrets (your Coinos.io login credentials).",
    );
  }

  const res = await fetch(`${COINOS_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Coinos login failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { token?: string; jwt?: string; [k: string]: unknown };
  const token = data.token ?? data.jwt ?? (data as Record<string, string>).access_token;
  if (!token) {
    throw new Error(`Coinos login: unexpected response — no token field. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  _jwtToken = token;
  _tokenFetchedAt = now;
  logger.info("Coinos JWT refreshed");
  return token;
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
