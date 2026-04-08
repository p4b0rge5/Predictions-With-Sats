/**
 * Weather Market Engine
 *
 * Predicts whether tomorrow's max temperature in a given city
 * will exceed a threshold (°C). Markets open 2 days ahead, close
 * at midnight local time, and settle at 23:59 UTC the target day.
 *
 * Uses Open-Meteo — free, no API key required.
 */

import { db, weatherMarketsTable, weatherBetsTable } from "@workspace/db";
import { eq, and, lt, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

// ── City definitions ──────────────────────────────────────────────────────────

export interface CityDef {
  key: string;
  name: string;
  country: string;
  emoji: string;
  latitude: number;
  longitude: number;
  threshold: number;
}

export const WEATHER_CITIES: CityDef[] = [
  { key: "sao-paulo",   name: "São Paulo",   country: "BR", emoji: "🇧🇷", latitude: -23.5505, longitude: -46.6333, threshold: 28 },
  { key: "new-york",    name: "New York",    country: "US", emoji: "🇺🇸", latitude:  40.7128, longitude: -74.0060, threshold: 15 },
  { key: "london",      name: "London",      country: "GB", emoji: "🇬🇧", latitude:  51.5074, longitude: -0.1278,  threshold: 14 },
  { key: "miami",       name: "Miami",       country: "US", emoji: "🌴", latitude:  25.7617, longitude: -80.1918, threshold: 30 },
  { key: "tokyo",       name: "Tokyo",       country: "JP", emoji: "🇯🇵", latitude:  35.6762, longitude: 139.6503, threshold: 18 },
  { key: "dubai",       name: "Dubai",       country: "AE", emoji: "🇦🇪", latitude:  25.2048, longitude:  55.2708, threshold: 35 },
];

// ── Open-Meteo fetcher ────────────────────────────────────────────────────────

export interface WeatherForecast {
  dates: string[];
  maxTemps: number[];
  currentTemp: number | null;
}

export async function fetchForecast(lat: number, lon: number): Promise<WeatherForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max` +
    `&current=temperature_2m` +
    `&timezone=UTC` +
    `&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as {
    current?: { temperature_2m?: number };
    daily: { time: string[]; temperature_2m_max: number[] };
  };
  return {
    dates: data.daily.time,
    maxTemps: data.daily.temperature_2m_max,
    currentTemp: data.current?.temperature_2m ?? null,
  };
}

// ── Market CRUD ───────────────────────────────────────────────────────────────

export async function getOrCreateMarketForCity(city: CityDef, date: string) {
  const [existing] = await db
    .select()
    .from(weatherMarketsTable)
    .where(and(eq(weatherMarketsTable.city, city.name), eq(weatherMarketsTable.date, date)))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(weatherMarketsTable)
    .values({
      city: city.name,
      country: city.country,
      latitude: city.latitude.toString(),
      longitude: city.longitude.toString(),
      date,
      threshold: city.threshold.toString(),
      status: "open",
    })
    .returning();

  logger.info({ city: city.name, date, threshold: city.threshold }, "Weather market created");
  return created;
}

export async function ensureTodayAndTomorrowMarkets(): Promise<void> {
  const now = new Date();
  const today = toDateString(now);
  const tomorrow = toDateString(new Date(now.getTime() + 86_400_000));

  for (const city of WEATHER_CITIES) {
    for (const date of [today, tomorrow]) {
      await getOrCreateMarketForCity(city, date).catch((err) =>
        logger.warn({ err, city: city.name, date }, "Failed to ensure weather market"),
      );
    }
  }
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Settlement ─────────────────────────────────────────────────────────────────

const PLATFORM_FEE = 0.02;

export async function settleWeatherMarket(marketId: number): Promise<void> {
  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, marketId))
    .limit(1);

  if (!market || market.status !== "open") return;

  // Check if the market date has passed
  const today = toDateString(new Date());
  if (market.date >= today) return; // not yet resolved

  // Fetch actual max temp for that date from Open-Meteo historical
  const lat = parseFloat(market.latitude);
  const lon = parseFloat(market.longitude);
  const histUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max` +
    `&timezone=UTC` +
    `&start_date=${market.date}&end_date=${market.date}`;

  let actualTemp: number;
  try {
    const res = await fetch(histUrl);
    const data = (await res.json()) as {
      daily: { time: string[]; temperature_2m_max: number[] };
    };
    actualTemp = data.daily.temperature_2m_max[0];
    if (actualTemp === null || actualTemp === undefined) {
      logger.warn({ marketId, date: market.date }, "No weather data yet for settlement");
      return;
    }
  } catch (err) {
    logger.warn({ err, marketId }, "Open-Meteo fetch failed for settlement");
    return;
  }

  const threshold = parseFloat(market.threshold);
  const outcome: "yes" | "no" = actualTemp >= threshold ? "yes" : "no";

  logger.info({ marketId, city: market.city, date: market.date, actualTemp, threshold, outcome }, "Settling weather market");

  const paidBets = await db
    .select()
    .from(weatherBetsTable)
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "paid")));

  if (paidBets.length === 0) {
    await db
      .update(weatherMarketsTable)
      .set({ status: "settled", outcome, actualTemp: actualTemp.toFixed(1), settledAt: new Date() })
      .where(eq(weatherMarketsTable.id, marketId));
    return;
  }

  const winnerBets = paidBets.filter((b) => b.direction === outcome);
  const loserBets = paidBets.filter((b) => b.direction !== outcome);

  if (winnerBets.length === 0) {
    // No winners — house keeps pool
    await db
      .update(weatherBetsTable)
      .set({ status: "lost" })
      .where(inArray(weatherBetsTable.id, loserBets.map((b) => b.id)));
  } else {
    const totalPool = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
    const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE));
    const totalWinnerStake = winnerBets.reduce((sum, b) => sum + b.amountSats, 0);

    for (const bet of paidBets) {
      const isWinner = bet.direction === outcome;
      const payoutSats = isWinner
        ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
        : null;
      await db
        .update(weatherBetsTable)
        .set({
          status: isWinner ? "won" : "lost",
          payoutSats,
          ...(isWinner ? { withdrawToken: randomUUID(), withdrawStatus: "unclaimed" } : {}),
        })
        .where(eq(weatherBetsTable.id, bet.id));
    }
  }

  // Expire pending bets
  await db
    .update(weatherBetsTable)
    .set({ status: "expired" })
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "pending")));

  await db
    .update(weatherMarketsTable)
    .set({ status: "settled", outcome, actualTemp: actualTemp.toFixed(1), settledAt: new Date() })
    .where(eq(weatherMarketsTable.id, marketId));

  logger.info({ marketId, outcome, actualTemp }, "Weather market settled");
}

export async function runWeatherSettlementCycle(): Promise<void> {
  await ensureTodayAndTomorrowMarkets();

  // Settle any open markets with past dates
  const now = new Date();
  const today = toDateString(now);
  const openPastMarkets = await db
    .select()
    .from(weatherMarketsTable)
    .where(and(eq(weatherMarketsTable.status, "open"), lt(weatherMarketsTable.date, today)));

  for (const market of openPastMarkets) {
    await settleWeatherMarket(market.id).catch((err) =>
      logger.warn({ err, marketId: market.id }, "Weather settlement error"),
    );
  }
}

// ── Pool helpers ──────────────────────────────────────────────────────────────

export async function addToWeatherPool(
  marketId: number,
  direction: "yes" | "no",
  amountSats: number,
): Promise<void> {
  const market = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, marketId))
    .limit(1);
  if (!market[0]) throw new Error(`Weather market ${marketId} not found`);

  if (direction === "yes") {
    await db
      .update(weatherMarketsTable)
      .set({ totalYesSats: market[0].totalYesSats + amountSats })
      .where(eq(weatherMarketsTable.id, marketId));
  } else {
    await db
      .update(weatherMarketsTable)
      .set({ totalNoSats: market[0].totalNoSats + amountSats })
      .where(eq(weatherMarketsTable.id, marketId));
  }
}
