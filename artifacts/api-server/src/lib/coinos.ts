/**
 * Coinos.io API client — used for outbound Lightning payments (winner payouts).
 *
 * Authentication: Coinos.io's /api/login endpoint requires hCaptcha, which
 * blocks automated server-to-server authentication. The JWT token must be
 * obtained manually and stored as the COINOS_JWT_TOKEN secret.
 *
 * To refresh the token when it expires:
 *   1. Log into https://coinos.io in your browser
 *   2. Open DevTools → Application → Local Storage → https://coinos.io
 *   3. Copy the value of the "token" key
 *   4. Update the COINOS_JWT_TOKEN secret in Replit Secrets
 *   (no server restart needed — the new value is picked up on the next use)
 *
 * Token health is checked at startup and every hour. Warnings appear in logs
 * starting 7 days before expiry so you know in advance.
 */

import { logger } from "./logger";

const COINOS_BASE = "https://coinos.io/api";

// ── JWT decoder (no signature verification — just reads the payload claims) ──

interface JwtPayload {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url").toString("utf8");
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

// Coinos tokens don't include an "exp" claim — they're server-side revoked.
// Empirically they last a few weeks. We track age via "iat" and warn past 21 days.
const TOKEN_WARN_DAYS = 21;

function tokenExpiryInfo(token: string): { expiresAt: Date | null; daysLeft: number | null; expired: boolean; issuedAt: Date | null; ageDays: number | null } {
  const payload = decodeJwtPayload(token);

  const issuedAt = payload?.iat ? new Date(payload.iat * 1000) : null;
  const ageDays = issuedAt ? Math.floor((Date.now() - issuedAt.getTime()) / (1000 * 60 * 60 * 24)) : null;

  if (payload?.exp) {
    const expiresAt = new Date(payload.exp * 1000);
    const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { expiresAt, daysLeft, expired: daysLeft < 0, issuedAt, ageDays };
  }

  // No exp claim — use age heuristic
  const expired = ageDays !== null && ageDays > TOKEN_WARN_DAYS + 14;
  const daysLeft = ageDays !== null ? Math.max(0, TOKEN_WARN_DAYS - ageDays) : null;
  return { expiresAt: null, daysLeft, expired, issuedAt, ageDays };
}

// ── Token access — always reads fresh from env so Replit secret updates ──
// ── take effect immediately without server restart ────────────────────────

function getEnvToken(): string | null {
  return process.env.COINOS_JWT_TOKEN ?? null;
}

// ── Health check — call at startup and periodically ──────────────────────

export async function checkCoinosTokenHealth(): Promise<void> {
  const jwt = getEnvToken();

  if (!jwt) {
    logger.error("COINOS_JWT_TOKEN is not set — winner payouts will fail until it is configured");
    return;
  }

  const { expiresAt, daysLeft, expired, issuedAt, ageDays } = tokenExpiryInfo(jwt);

  if (expired) {
    logger.error(
      { issuedAt, ageDays, expiresAt },
      "COINOS_JWT_TOKEN appears expired — update the secret in Replit Secrets to restore winner payouts",
    );
  } else if (daysLeft !== null && daysLeft <= 7) {
    logger.warn(
      { issuedAt, ageDays, daysLeft },
      `COINOS_JWT_TOKEN is getting old (${ageDays} days) — consider refreshing soon to avoid payout failures`,
    );
  }

  // Verify against the API (catches server-side revocation)
  try {
    const res = await fetch(`${COINOS_BASE}/me`, {
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      logger.error(
        "COINOS_JWT_TOKEN rejected by Coinos API (revoked or expired) — update the secret in Replit Secrets. " +
        "Log into coinos.io → DevTools → Application → Local Storage → copy 'token' value.",
      );
    } else if (res.ok) {
      logger.info({ issuedAt, ageDays }, "Coinos token health check passed ✓");
    } else {
      logger.warn({ status: res.status }, "Coinos health check returned unexpected status");
    }
  } catch (err) {
    logger.warn({ err }, "Coinos health check request failed (network issue?)");
  }
}

// ── Token status — for the health API endpoint ────────────────────────────

export function getCoinosTokenStatus(): {
  configured: boolean;
  issuedAt: string | null;
  ageDays: number | null;
  daysUntilStale: number | null;
  expired: boolean;
} {
  const jwt = getEnvToken();
  if (!jwt) return { configured: false, issuedAt: null, ageDays: null, daysUntilStale: null, expired: false };
  const { daysLeft, expired, issuedAt, ageDays } = tokenExpiryInfo(jwt);
  return {
    configured: true,
    issuedAt: issuedAt?.toISOString() ?? null,
    ageDays,
    daysUntilStale: daysLeft,
    expired,
  };
}

// ── Internal token getter — reads env var fresh on every call ─────────────

async function getCoinosToken(): Promise<string> {
  const jwt = getEnvToken();

  if (!jwt) {
    throw new Error(
      "COINOS_JWT_TOKEN secret is not set. " +
      "Log into coinos.io → DevTools → Application → Local Storage → copy the 'token' value → add it as COINOS_JWT_TOKEN in Replit Secrets.",
    );
  }

  const { expired, daysLeft, ageDays } = tokenExpiryInfo(jwt);

  if (expired) {
    throw new Error(
      "COINOS_JWT_TOKEN is expired or very old. Update the secret in Replit Secrets — the new value takes effect immediately without restarting the server.",
    );
  }

  if (daysLeft !== null && daysLeft <= 3) {
    logger.warn({ ageDays, daysLeft }, "COINOS_JWT_TOKEN is very old — update it now to avoid payout failures");
  }

  return jwt;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Pay a Lightning invoice from the Coinos account.
 * Used to pay out winning bets via LNURL-Withdraw.
 */
export async function coinosPayInvoice(bolt11: string, amountSats: number): Promise<void> {
  const token = await getCoinosToken();

  const payBody = { payreq: bolt11, amount: amountSats };

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

    if (res.status === 401) {
      logger.error(
        "Coinos payment rejected with 401 — COINOS_JWT_TOKEN is expired or invalid. " +
        "Update the secret in Replit Secrets (no restart needed).",
      );
    }

    throw new Error(`Coinos payment failed (${res.status}): ${text}`);
  }

  const result = await res.json().catch(() => ({})) as Record<string, unknown>;
  logger.info({ amountSats, resultKeys: Object.keys(result) }, "Coinos Lightning payment sent");
}
