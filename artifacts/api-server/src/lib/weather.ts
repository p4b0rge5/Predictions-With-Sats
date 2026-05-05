import { db, weatherBetsTable, weatherMarketsTable, type WeatherOutcomeRecord } from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fetchPolymarketWeatherMarkets, type ExternalWeatherMarket } from "./polymarket-weather";
import { logger } from "./logger";

const PLATFORM_FEE = 0.02;
const NO_LIQUIDITY_REFUND_FEE = 0.005;
const SYNC_TTL_MS = 5 * 60 * 1000;

let lastSuccessfulSyncAt = 0;
let activeSync: Promise<void> | null = null;
let latestPolymarketRelevance = new Map<string, number>();

function normalizeMarketOutcomes(raw: unknown): WeatherOutcomeRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const candidate = item as Partial<WeatherOutcomeRecord>;
    if (typeof candidate.key !== "string" || typeof candidate.label !== "string") return [];

    return [{
      key: candidate.key,
      label: candidate.label,
      price: typeof candidate.price === "number" && Number.isFinite(candidate.price) ? candidate.price : null,
      poolSats: typeof candidate.poolSats === "number" && Number.isFinite(candidate.poolSats) ? candidate.poolSats : 0,
      isWinner: typeof candidate.isWinner === "boolean" ? candidate.isWinner : null,
      sourceMarketId: typeof candidate.sourceMarketId === "string" ? candidate.sourceMarketId : undefined,
      sortOrder: typeof candidate.sortOrder === "number" && Number.isFinite(candidate.sortOrder) ? candidate.sortOrder : undefined,
    }];
  });
}

function mergeOutcomePools(
  incoming: ExternalWeatherMarket["outcomes"],
  existing: WeatherOutcomeRecord[],
): WeatherOutcomeRecord[] {
  const existingByKey = new Map(
    existing.map((outcome) => [outcome.sourceMarketId ?? outcome.key, outcome]),
  );
  return incoming.map((outcome) => ({
    ...outcome,
    poolSats: existingByKey.get(outcome.sourceMarketId ?? outcome.key)?.poolSats ?? 0,
  }));
}

function getLegacyPools(outcomes: WeatherOutcomeRecord[]): { totalYesSats: number; totalNoSats: number } {
  const byKey = new Map(outcomes.map((outcome) => [outcome.key, outcome.poolSats]));
  return {
    totalYesSats: byKey.get("yes") ?? 0,
    totalNoSats: byKey.get("no") ?? 0,
  };
}

function getMarketStatus(market: ExternalWeatherMarket): "open" | "settled" {
  return market.winningOutcome ? "settled" : market.status;
}

function formatThreshold(value: number | null): string {
  return value === null ? "0" : value.toFixed(1);
}

export async function getOrSyncWeatherMarkets(force = false): Promise<void> {
  if (!force && Date.now() - lastSuccessfulSyncAt < SYNC_TTL_MS) return;
  if (activeSync) return activeSync;

  activeSync = (async () => {
    const externalMarkets = await fetchPolymarketWeatherMarkets();
    latestPolymarketRelevance = new Map(
      externalMarkets.map((market, index) => [market.externalMarketId, market.relevanceRank ?? index]),
    );

    for (const externalMarket of externalMarkets) {
      const [existing] = await db
        .select()
        .from(weatherMarketsTable)
        .where(eq(weatherMarketsTable.externalMarketId, externalMarket.externalMarketId))
        .limit(1);

      const mergedOutcomes = mergeOutcomePools(externalMarket.outcomes, normalizeMarketOutcomes(existing?.outcomes));
      const { totalYesSats, totalNoSats } = getLegacyPools(mergedOutcomes);
      const values = {
        city: externalMarket.city,
        country: externalMarket.country,
        latitude: "0",
        longitude: "0",
        date: externalMarket.date,
        threshold: formatThreshold(externalMarket.threshold),
        provider: "polymarket",
        externalMarketId: externalMarket.externalMarketId,
        question: externalMarket.question,
        subtitle: externalMarket.subtitle,
        sourceUrl: externalMarket.sourceUrl,
        outcomes: mergedOutcomes,
        winningOutcome: externalMarket.winningOutcome,
        resolvedValue: externalMarket.resolvedValue,
        status: getMarketStatus(externalMarket),
        outcome: externalMarket.winningOutcome,
        actualTemp: null,
        totalYesSats,
        totalNoSats,
        settledAt: externalMarket.winningOutcome ? (externalMarket.settledAt ?? existing?.settledAt ?? new Date()) : null,
      } as const;

      if (existing) {
        await db
          .update(weatherMarketsTable)
          .set(values)
          .where(eq(weatherMarketsTable.id, existing.id));
      } else {
        await db.insert(weatherMarketsTable).values(values);
      }
    }

    lastSuccessfulSyncAt = Date.now();
    await settleResolvedWeatherMarkets();
  })()
    .catch((err) => {
      logger.warn({ err }, "Weather market sync failed");
      throw err;
    })
    .finally(() => {
      activeSync = null;
    });

  return activeSync;
}

export async function listWeatherMarkets(): Promise<(typeof weatherMarketsTable.$inferSelect)[]> {
  getOrSyncWeatherMarkets().catch((err) => logger.warn({ err }, "Background weather sync failed"));

  const historyStart = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const markets = await db
    .select()
    .from(weatherMarketsTable)
    .where(gte(weatherMarketsTable.date, historyStart))
    .orderBy(weatherMarketsTable.date, weatherMarketsTable.city);

  const sortedMarkets = [...markets].sort((left, right) => {
    const leftRank = left.externalMarketId ? latestPolymarketRelevance.get(left.externalMarketId) : undefined;
    const rightRank = right.externalMarketId ? latestPolymarketRelevance.get(right.externalMarketId) : undefined;
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }

    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return left.city.localeCompare(right.city);
  });

  const polymarketMarkets = sortedMarkets.filter(
    (market) => market.provider === "polymarket" && market.externalMarketId?.startsWith("group:"),
  );
  return polymarketMarkets.length > 0 ? polymarketMarkets : sortedMarkets;
}

function getWinningOutcome(market: typeof weatherMarketsTable.$inferSelect): string | null {
  return market.winningOutcome ?? market.outcome ?? null;
}

export async function settleWeatherMarket(marketId: number): Promise<void> {
  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, marketId))
    .limit(1);

  if (!market) return;

  const winningOutcome = getWinningOutcome(market);
  if (!winningOutcome) return;

  const paidBets = await db
    .select()
    .from(weatherBetsTable)
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "paid")));

  if (paidBets.length === 0) {
    await db
      .update(weatherMarketsTable)
      .set({
        status: "settled",
        winningOutcome,
        outcome: winningOutcome,
        settledAt: market.settledAt ?? new Date(),
      })
      .where(eq(weatherMarketsTable.id, marketId));
    return;
  }

  const winnerBets = paidBets.filter((bet) => bet.direction === winningOutcome);
  const totalPool = paidBets.reduce((sum, bet) => sum + bet.amountSats, 0);
  const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE));
  const totalWinnerStake = winnerBets.reduce((sum, bet) => sum + bet.amountSats, 0);
  const paidOutcomeCount = new Set(paidBets.map((bet) => bet.direction)).size;

  if (paidOutcomeCount <= 1) {
    for (const bet of paidBets) {
      const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
      await db
        .update(weatherBetsTable)
        .set({
          status: "refunded",
          payoutSats: refundSats,
          withdrawToken: bet.withdrawToken ?? randomUUID(),
          withdrawStatus: "unclaimed",
        })
        .where(eq(weatherBetsTable.id, bet.id));
    }

    await db
      .update(weatherBetsTable)
      .set({ status: "expired" })
      .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "pending")));

    await db
      .update(weatherMarketsTable)
      .set({
        status: "settled",
        winningOutcome,
        outcome: winningOutcome,
        settledAt: market.settledAt ?? new Date(),
      })
      .where(eq(weatherMarketsTable.id, marketId));

    logger.info(
      { marketId, winningOutcome, refundedBets: paidBets.length, refundFeeRate: NO_LIQUIDITY_REFUND_FEE },
      "Weather market settled with no opposing liquidity",
    );
    return;
  }

  for (const bet of paidBets) {
    const isWinner = bet.direction === winningOutcome && totalWinnerStake > 0;
    const payoutSats = isWinner
      ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
      : null;

    await db
      .update(weatherBetsTable)
      .set({
        status: isWinner ? "won" : "lost",
        payoutSats,
        ...(isWinner ? { withdrawToken: bet.withdrawToken ?? randomUUID(), withdrawStatus: "unclaimed" } : {}),
      })
      .where(eq(weatherBetsTable.id, bet.id));
  }

  await db
    .update(weatherBetsTable)
    .set({ status: "expired" })
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "pending")));

  await db
    .update(weatherMarketsTable)
    .set({
      status: "settled",
      winningOutcome,
      outcome: winningOutcome,
      settledAt: market.settledAt ?? new Date(),
    })
    .where(eq(weatherMarketsTable.id, marketId));
}

// ── Early refund: no opposing liquidity ────────────────────────────────────
// When the market date is past (betting closed) but no winning outcome is yet
// available from Polymarket, check if all paid bets are on a single outcome.
// If so, refund everyone immediately — no need to wait for the resolution.

async function tryEarlyWeatherRefund(marketId: number): Promise<boolean> {
  const paidBets = await db
    .select()
    .from(weatherBetsTable)
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "paid")));

  if (paidBets.length === 0) return false;

  const paidOutcomeCount = new Set(paidBets.map((b) => b.direction)).size;
  if (paidOutcomeCount > 1) return false;

  // All bets on one outcome — refund immediately
  for (const bet of paidBets) {
    const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
    await db
      .update(weatherBetsTable)
      .set({
        status: "refunded",
        payoutSats: refundSats,
        withdrawToken: bet.withdrawToken ?? randomUUID(),
        withdrawStatus: "unclaimed",
      })
      .where(eq(weatherBetsTable.id, bet.id));
  }

  // Also expire any still-pending invoices
  await db
    .update(weatherBetsTable)
    .set({ status: "expired" })
    .where(and(eq(weatherBetsTable.marketId, marketId), eq(weatherBetsTable.status, "pending")));

  await db
    .update(weatherMarketsTable)
    .set({
      status: "settled",
      settledAt: new Date(),
    })
    .where(and(eq(weatherMarketsTable.id, marketId), eq(weatherMarketsTable.status, "open")));

  logger.info(
    { marketId, refundedBets: paidBets.length, refundFeeRate: NO_LIQUIDITY_REFUND_FEE },
    "Weather market — early refund (single outcome, no opposing liquidity)",
  );
  return true;
}

export async function settleResolvedWeatherMarkets(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const markets = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.provider, "polymarket"));

  for (const market of markets) {
    if (market.status !== "open") continue;

    const winningOutcome = getWinningOutcome(market);

    if (winningOutcome) {
      // Normal settlement path — result is known
      await settleWeatherMarket(market.id).catch((err) =>
        logger.warn({ err, marketId: market.id }, "Weather settlement error"),
      );
    } else if (market.date < today) {
      // Date is past but no resolution yet — try early refund
      await tryEarlyWeatherRefund(market.id).catch((err) =>
        logger.warn({ err, marketId: market.id }, "Early weather refund error"),
      );
    }
  }
}

export async function runWeatherSettlementCycle(): Promise<void> {
  await getOrSyncWeatherMarkets(true);
}

export async function addToWeatherPool(
  marketId: number,
  outcomeKey: string,
  amountSats: number,
): Promise<void> {
  const [market] = await db
    .select()
    .from(weatherMarketsTable)
    .where(eq(weatherMarketsTable.id, marketId))
    .limit(1);

  if (!market) throw new Error(`Weather market ${marketId} not found`);

  const outcomes = normalizeMarketOutcomes(market.outcomes);
  const updated = outcomes.map((outcome) =>
    outcome.key === outcomeKey
      ? { ...outcome, poolSats: outcome.poolSats + amountSats }
      : outcome,
  );

  const { totalYesSats, totalNoSats } = getLegacyPools(updated);

  await db
    .update(weatherMarketsTable)
    .set({ outcomes: updated, totalYesSats, totalNoSats })
    .where(eq(weatherMarketsTable.id, marketId));
}

export function getOutcomeForMarket(
  market: typeof weatherMarketsTable.$inferSelect,
  outcomeKey: string,
): WeatherOutcomeRecord | null {
  return normalizeMarketOutcomes(market.outcomes).find((outcome) => outcome.key === outcomeKey) ?? null;
}
