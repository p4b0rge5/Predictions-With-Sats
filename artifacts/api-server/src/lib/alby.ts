/**
 * Alby Lightning payment integration via LNURL-Pay.
 *
 * Invoice creation uses the LNURL-Pay protocol against the configured
 * Lightning Address (e.g. user@getalby.com).  Alby's own node handles
 * routing — no self-hosted node or "funding source" needed.
 *
 * Payment confirmation arrives via webhook (POST /api/webhook/alby).
 * Register the webhook once in your Alby account dashboard:
 *   https://getalby.com/developer/webhooks
 * and point it at: https://<your-domain>/api/webhook/alby
 */

import { decode as decodeBolt11 } from "bolt11";
import { getConfig } from "./config";
import { logger } from "./logger";

const ALBY_API_BASE = "https://api.getalby.com";

// ---------------------------------------------------------------------------
// LNURL-Pay helpers
// ---------------------------------------------------------------------------

interface LnurlPayInfo {
  callback: string;
  minSendable: number; // millisats
  maxSendable: number; // millisats
  metadata: string;
  commentAllowed?: number;
}

interface LnurlPayCallbackResponse {
  pr: string; // BOLT11 invoice
  routes?: unknown[];
  status?: string;
  reason?: string;
}

async function fetchLnurlPayInfo(lightningAddress: string): Promise<LnurlPayInfo> {
  const [user, domain] = lightningAddress.split("@");
  if (!user || !domain) {
    throw new Error(`Invalid Lightning Address format: ${lightningAddress}`);
  }

  const url = `https://${domain}/.well-known/lnurlp/${user}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`LNURL-Pay service unreachable (${res.status}): ${url}`);
  }
  const body = await res.json() as LnurlPayInfo & { status?: string; reason?: string };
  if (body.status === "ERROR") {
    throw new Error(`LNURL-Pay service error: ${body.reason}`);
  }
  return body;
}

async function requestInvoiceFromCallback(
  info: LnurlPayInfo,
  amountMsats: number,
  comment?: string,
): Promise<string> {
  const callbackUrl = new URL(info.callback);
  callbackUrl.searchParams.set("amount", amountMsats.toString());
  if (comment && info.commentAllowed && info.commentAllowed > 0) {
    callbackUrl.searchParams.set("comment", comment.slice(0, info.commentAllowed));
  }

  const res = await fetch(callbackUrl.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`LNURL-Pay callback failed (${res.status})`);
  }
  const body = await res.json() as LnurlPayCallbackResponse;
  if (body.status === "ERROR") {
    throw new Error(`LNURL-Pay callback error: ${body.reason}`);
  }
  if (!body.pr) {
    throw new Error("LNURL-Pay callback returned no invoice (pr field missing)");
  }
  return body.pr;
}

function extractPaymentHashFromBolt11(paymentRequest: string): string {
  const decoded = decodeBolt11(paymentRequest);
  const hashTag = decoded.tags.find((t) => t.tagName === "payment_hash");
  if (!hashTag || typeof hashTag.data !== "string") {
    throw new Error("BOLT11 invoice missing payment_hash tag");
  }
  return hashTag.data;
}

function bolt11ExpiresAt(paymentRequest: string): string {
  try {
    const decoded = decodeBolt11(paymentRequest);
    const timestamp = decoded.timestamp ?? Math.floor(Date.now() / 1000);
    const expiry = (decoded.tags.find((t) => t.tagName === "expire_time")?.data as number | undefined) ?? 3600;
    return new Date((timestamp + expiry) * 1000).toISOString();
  } catch {
    return new Date(Date.now() + 3600 * 1000).toISOString();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createInvoice(
  amountSats: number,
  memo: string,
): Promise<{ paymentHash: string; paymentRequest: string; expiresAt: string }> {
  const { lightningAddress } = getConfig();

  logger.info({ amountSats, lightningAddress }, "Creating LNURL-Pay invoice");

  const amountMsats = amountSats * 1000;

  const info = await fetchLnurlPayInfo(lightningAddress);

  if (amountMsats < info.minSendable) {
    throw new Error(
      `Amount too small: ${amountSats} sats (minimum ${info.minSendable / 1000} sats)`,
    );
  }
  if (amountMsats > info.maxSendable) {
    throw new Error(
      `Amount too large: ${amountSats} sats (maximum ${info.maxSendable / 1000} sats)`,
    );
  }

  const paymentRequest = await requestInvoiceFromCallback(info, amountMsats, memo);
  const paymentHash = extractPaymentHashFromBolt11(paymentRequest);
  const expiresAt = bolt11ExpiresAt(paymentRequest);

  logger.info({ paymentHash, amountSats }, "LNURL-Pay invoice created");

  return { paymentHash, paymentRequest, expiresAt };
}

// ---------------------------------------------------------------------------
// Webhook registration (best-effort — requires ALBY_API_TOKEN + webhook URL)
// ---------------------------------------------------------------------------

interface AlbyWebhook {
  id: string;
  url: string;
  filter_types: string[];
}

async function albyFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { albyApiToken } = getConfig();
  const res = await fetch(`${ALBY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${albyApiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Alby API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Registers our webhook with Alby if a WEBHOOK_URL is configured.
 * Called once at server startup.  Silently skips if already registered
 * or if Alby returns an error (e.g. account not fully set up).
 */
export async function ensureWebhookRegistered(webhookUrl: string): Promise<void> {
  const { albyApiToken } = getConfig();
  if (!albyApiToken) return;

  try {
    const existing = await albyFetch<AlbyWebhook[]>("GET", "/webhooks");
    const alreadyExists = existing.some((wh) => wh.url === webhookUrl);
    if (alreadyExists) {
      logger.info({ webhookUrl }, "Alby webhook already registered");
      return;
    }

    await albyFetch("POST", "/webhooks", {
      url: webhookUrl,
      filter_types: ["payment.incoming.settled"],
    });
    logger.info({ webhookUrl }, "Alby webhook registered successfully");
  } catch (err) {
    logger.warn(
      { err, webhookUrl },
      "Could not auto-register Alby webhook — please add it manually at https://getalby.com/developer/webhooks",
    );
  }
}
