import { decode as decodeBolt11 } from "bolt11";

type Bolt11Tag = {
  tagName?: string;
  data?: unknown;
};

type DecodedBolt11 = {
  satoshis?: number | null;
  millisatoshis?: number | string | null;
  timestamp?: number;
  timeExpireDate?: number;
  tags: Bolt11Tag[];
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getInvoiceAmountSats(decoded: DecodedBolt11): number | null {
  const millisatoshis = toFiniteNumber(decoded.millisatoshis);
  if (millisatoshis !== null) {
    if (!Number.isInteger(millisatoshis) || millisatoshis <= 0 || millisatoshis % 1000 !== 0) return null;
    return millisatoshis / 1000;
  }

  const satoshis = toFiniteNumber(decoded.satoshis);
  if (satoshis !== null) {
    if (!Number.isInteger(satoshis) || satoshis <= 0) return null;
    return satoshis;
  }

  return null;
}

function getInvoiceExpiryUnix(decoded: DecodedBolt11): number | null {
  if (typeof decoded.timeExpireDate === "number" && Number.isFinite(decoded.timeExpireDate)) {
    return decoded.timeExpireDate;
  }

  const expireTime = decoded.tags.find((tag) => tag.tagName === "expire_time")?.data;
  const expireSeconds = toFiniteNumber(expireTime) ?? 3600;
  if (typeof decoded.timestamp !== "number" || !Number.isFinite(decoded.timestamp)) return null;
  return decoded.timestamp + expireSeconds;
}

export function validateExactInvoiceAmount(paymentRequest: string, expectedSats: number): void {
  if (!Number.isInteger(expectedSats) || expectedSats <= 0) {
    throw new Error("Invalid expected payout amount");
  }

  let decoded: DecodedBolt11;
  try {
    decoded = decodeBolt11(paymentRequest) as unknown as DecodedBolt11;
  } catch {
    throw new Error("Malformed BOLT11 invoice");
  }

  const paymentHash = decoded.tags.find((tag) => tag.tagName === "payment_hash")?.data;
  if (typeof paymentHash !== "string" || paymentHash.length === 0) {
    throw new Error("Invoice is missing a payment hash");
  }

  const amountSats = getInvoiceAmountSats(decoded);
  if (amountSats === null) {
    throw new Error("Invoice must specify an exact amount in whole sats");
  }

  if (amountSats !== expectedSats) {
    throw new Error(`Invoice amount mismatch: expected ${expectedSats} sats, got ${amountSats} sats`);
  }

  const expiryUnix = getInvoiceExpiryUnix(decoded);
  if (expiryUnix !== null && expiryUnix <= Math.floor(Date.now() / 1000)) {
    throw new Error("Invoice is already expired");
  }
}
