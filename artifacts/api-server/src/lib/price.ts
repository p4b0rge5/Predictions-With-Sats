import { db, priceSnapshotsTable } from "@workspace/db";
import { logger } from "./logger";

interface SourceResult {
  name: string;
  price: number;
}

async function fetchFromBinance(): Promise<number> {
  const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = (await res.json()) as { price: string };
  return parseFloat(data.price);
}

async function fetchFromCoinbase(): Promise<number> {
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return parseFloat(data.data.amount);
}

async function fetchFromKraken(): Promise<number> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = (await res.json()) as { result: { XXBTZUSD: { c: string[] } } };
  return parseFloat(data.result.XXBTZUSD.c[0]);
}

type NamedFetch = { name: string; fn: () => Promise<number> };

const priceSources: NamedFetch[] = [
  { name: "binance", fn: fetchFromBinance },
  { name: "coinbase", fn: fetchFromCoinbase },
  { name: "kraken", fn: fetchFromKraken },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

let cachedPrice: number | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10_000;

export function getLastKnownPrice(): number | null {
  return cachedPrice;
}

async function fetchFromSources(): Promise<SourceResult[]> {
  const settled = await Promise.allSettled(priceSources.map(s => s.fn()));
  const results: SourceResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      results.push({ name: priceSources[i].name, price: r.value });
    } else {
      logger.warn({ source: priceSources[i].name, reason: String(r.reason) }, "Price source failed");
    }
  }
  return results;
}

export async function getCachedBtcPrice(): Promise<number> {
  if (cachedPrice !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedPrice;
  }
  const sources = await fetchFromSources();
  if (sources.length === 0) {
    if (cachedPrice !== null) return cachedPrice;
    throw new Error("All price sources failed and no cached price available");
  }
  const price = median(sources.map(s => s.price));
  cachedPrice = price;
  cachedAt = Date.now();
  return price;
}

export async function fetchAndStoreBtcPrice(
  windowId: number | null,
  isClose: boolean,
): Promise<number> {
  const sources = await fetchFromSources();
  if (sources.length === 0) {
    throw new Error("All price sources failed");
  }
  const price = median(sources.map(s => s.price));
  cachedPrice = price;
  cachedAt = Date.now();

  await db.insert(priceSnapshotsTable).values(
    sources.map(s => ({
      windowId,
      source: s.name,
      priceUsd: s.price.toFixed(2),
      isClose,
    })),
  );

  logger.info({ windowId, isClose, price, sources: sources.length }, "BTC price fetched");
  return price;
}
