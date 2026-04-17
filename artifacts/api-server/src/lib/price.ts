import { db, priceSnapshotsTable } from "@workspace/db";
import { logger } from "./logger";

export type CryptoAsset = "btc" | "eth" | "sol";

export interface SourceResult {
  name: string;
  price: number;
}

// ── BTC sources ─────────────────────────────────────────────────────────────

async function fetchBtcCoinbase(): Promise<number> {
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return parseFloat(data.data.amount);
}

async function fetchBtcKraken(): Promise<number> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = (await res.json()) as { result: { XXBTZUSD: { c: string[] } } };
  return parseFloat(data.result.XXBTZUSD.c[0]);
}

async function fetchBtcBitfinex(): Promise<number> {
  const res = await fetch("https://api-pub.bitfinex.com/v2/ticker/tBTCUSD");
  if (!res.ok) throw new Error(`Bitfinex HTTP ${res.status}`);
  const data = (await res.json()) as number[];
  return data[6];
}

async function fetchBtcCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json()) as { bitcoin: { usd: number } };
  return data.bitcoin.usd;
}

// ── ETH sources ─────────────────────────────────────────────────────────────

async function fetchEthCoinbase(): Promise<number> {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot");
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return parseFloat(data.data.amount);
}

async function fetchEthKraken(): Promise<number> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHUSD");
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = (await res.json()) as { result: Record<string, { c: string[] }> };
  const key = Object.keys(data.result)[0];
  return parseFloat(data.result[key].c[0]);
}

async function fetchEthBitfinex(): Promise<number> {
  const res = await fetch("https://api-pub.bitfinex.com/v2/ticker/tETHUSD");
  if (!res.ok) throw new Error(`Bitfinex HTTP ${res.status}`);
  const data = (await res.json()) as number[];
  return data[6];
}

async function fetchEthCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json()) as { ethereum: { usd: number } };
  return data.ethereum.usd;
}

// ── SOL sources ─────────────────────────────────────────────────────────────

async function fetchSolKraken(): Promise<number> {
  const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=SOLUSD");
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const data = (await res.json()) as { result: Record<string, { c: string[] }> };
  const key = Object.keys(data.result)[0];
  return parseFloat(data.result[key].c[0]);
}

async function fetchSolCoinbase(): Promise<number> {
  const res = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot");
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = (await res.json()) as { data: { amount: string } };
  return parseFloat(data.data.amount);
}

async function fetchSolCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = (await res.json()) as { solana: { usd: number } };
  return data.solana.usd;
}

// ── Source registry ──────────────────────────────────────────────────────────

type NamedFetch = { name: string; fn: () => Promise<number> };

const SOURCES: Record<CryptoAsset, NamedFetch[]> = {
  btc: [
    { name: "coinbase", fn: fetchBtcCoinbase },
    { name: "kraken",   fn: fetchBtcKraken },
    { name: "bitfinex", fn: fetchBtcBitfinex },
    { name: "coingecko", fn: fetchBtcCoinGecko },
  ],
  eth: [
    { name: "coinbase", fn: fetchEthCoinbase },
    { name: "kraken",   fn: fetchEthKraken },
    { name: "bitfinex", fn: fetchEthBitfinex },
    { name: "coingecko", fn: fetchEthCoinGecko },
  ],
  sol: [
    { name: "kraken",   fn: fetchSolKraken },
    { name: "coinbase", fn: fetchSolCoinbase },
    { name: "coingecko", fn: fetchSolCoinGecko },
  ],
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── Per-asset cache ──────────────────────────────────────────────────────────

const cache: Record<CryptoAsset, { price: number | null; at: number }> = {
  btc: { price: null, at: 0 },
  eth: { price: null, at: 0 },
  sol: { price: null, at: 0 },
};

const CACHE_TTL_MS = 10_000;

export function getLastKnownPrice(asset: CryptoAsset = "btc"): number | null {
  return cache[asset].price;
}

export async function fetchPricesRaw(
  asset: CryptoAsset = "btc",
): Promise<{ sources: SourceResult[]; price: number }> {
  const sources_defs = SOURCES[asset];
  const settled = await Promise.allSettled(sources_defs.map((s) => s.fn()));
  const sources: SourceResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      sources.push({ name: sources_defs[i].name, price: r.value });
    } else {
      logger.warn({ source: sources_defs[i].name, asset, reason: String(r.reason) }, "Price source failed");
    }
  }
  if (sources.length === 0) {
    const cached = cache[asset].price;
    if (cached !== null) return { sources: [], price: cached };
    throw new Error(`All price sources failed for ${asset} and no cached price available`);
  }
  const price = median(sources.map((s) => s.price));
  cache[asset] = { price, at: Date.now() };
  return { sources, price };
}

export async function storePriceSnapshots(
  windowId: number,
  isClose: boolean,
  sources: SourceResult[],
): Promise<void> {
  if (sources.length === 0) return;
  await db.insert(priceSnapshotsTable).values(
    sources.map((s) => ({
      windowId,
      source: s.name,
      priceUsd: s.price.toFixed(2),
      isClose,
    })),
  );
}

export async function getCachedPrice(asset: CryptoAsset = "btc"): Promise<number> {
  const c = cache[asset];
  if (c.price !== null && Date.now() - c.at < CACHE_TTL_MS) {
    return c.price;
  }
  const { price } = await fetchPricesRaw(asset);
  return price;
}

export async function fetchAndStorePrice(
  windowId: number,
  isClose: boolean,
  asset: CryptoAsset = "btc",
): Promise<number> {
  const { sources, price } = await fetchPricesRaw(asset);
  await storePriceSnapshots(windowId, isClose, sources);
  logger.info({ windowId, isClose, price, asset, sources: sources.length }, "Price fetched");
  return price;
}

// Backwards-compatible aliases
export const getCachedBtcPrice = () => getCachedPrice("btc");
export const getLastKnownBtcPrice = () => getLastKnownPrice("btc");
export async function fetchAndStoreBtcPrice(windowId: number, isClose: boolean): Promise<number> {
  return fetchAndStorePrice(windowId, isClose, "btc");
}
