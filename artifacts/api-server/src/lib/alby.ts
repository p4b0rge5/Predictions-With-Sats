import { getConfig } from "./config";
import { logger } from "./logger";

const ALBY_API_BASE = "https://api.getalby.com";

export interface AlbyInvoice {
  paymentHash: string;
  paymentRequest: string;
  expiresAt: string;
  amount: number;
  settled: boolean;
}

interface AlbyCreateInvoiceResponse {
  payment_hash: string;
  payment_request: string;
  expires_at: string;
  amount: number;
}

interface AlbyGetInvoiceResponse {
  payment_hash: string;
  payment_request: string;
  amount: number;
  settled: boolean;
  expires_at?: string;
}

async function albyFetch<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const { albyApiToken } = getConfig();
  const url = `${ALBY_API_BASE}${path}`;

  const res = await fetch(url, {
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

export async function createInvoice(
  amountSats: number,
  memo: string,
): Promise<{ paymentHash: string; paymentRequest: string; expiresAt: string }> {
  logger.info({ amountSats, memo }, "Creating Alby invoice");

  const data = await albyFetch<AlbyCreateInvoiceResponse>("POST", "/invoices", {
    amount: amountSats,
    memo,
  });

  if (!data.payment_hash || !data.payment_request) {
    throw new Error("Alby invoice response missing payment_hash or payment_request");
  }

  logger.info({ paymentHash: data.payment_hash, amountSats }, "Alby invoice created");

  return {
    paymentHash: data.payment_hash,
    paymentRequest: data.payment_request,
    expiresAt: data.expires_at,
  };
}

export async function getInvoice(paymentHash: string): Promise<AlbyInvoice> {
  const data = await albyFetch<AlbyGetInvoiceResponse>(
    "GET",
    `/invoices/${paymentHash}`,
  );

  return {
    paymentHash: data.payment_hash,
    paymentRequest: data.payment_request,
    amount: data.amount,
    settled: data.settled ?? false,
    expiresAt: data.expires_at ?? "",
  };
}
