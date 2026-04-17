import { db, sportPolyBetsTable, sportPolyMarketsTable, type SportPolyOutcomeRecord } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  fetchPolymarketSportsMarkets,
  normalizeStoredSport,
  type ExternalSportPolyMarket,
} from "./polymarket-sports";
import { logger } from "./logger";

const PLATFORM_FEE = 0.02;
const SYNC_TTL_MS = 5 * 60 * 1000;

let lastSuccessfulSyncAt = 0;
let activeSync: Promise<void> | null = null;
let latestPolymarketRelevance = new Map<string, number>();

function normalizeMarketOutcomes(raw: unknown): SportPolyOutcomeRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const candidate = item as Partial<SportPolyOutcomeRecord>;
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
  incoming: ExternalSportPolyMarket["outcomes"],
  existing: SportPolyOutcomeRecord[],
): SportPolyOutcomeRecord[] {
  const existingByKey = new Map(
    existing.map((outcome) => [outcome.sourceMarketId ?? outcome.key, outcome]),
  );

  return incoming.map((outcome) => ({
    ...outcome,
    poolSats: existingByKey.get(outcome.sourceMarketId ?? outcome.key)?.poolSats ?? 0,
  }));
}

function getWinningOutcome(market: typeof sportPolyMarketsTable.$inferSelect): string | null {
  return market.winningOutcome ?? null;
}

export async function getOrSyncSportsPolyMarkets(force = false): Promise<void> {
  if (!force && Date.now() - lastSuccessfulSyncAt < SYNC_TTL_MS) return;
  if (activeSync) {
    if (force) return activeSync;
    return;
  }

  activeSync = (async () => {
    const externalMarkets = await fetchPolymarketSportsMarkets();
    latestPolymarketRelevance = new Map(
      externalMarkets.map((market, index) => [market.externalMarketId, market.relevanceRank ?? index]),
    );

    for (const externalMarket of externalMarkets) {
      const [existing] = await db
        .select()
        .from(sportPolyMarketsTable)
        .where(eq(sportPolyMarketsTable.externalMarketId, externalMarket.externalMarketId))
        .limit(1);

      const mergedOutcomes = mergeOutcomePools(externalMarket.outcomes, normalizeMarketOutcomes(existing?.outcomes));
      const values = {
        provider: externalMarket.provider,
        externalMarketId: externalMarket.externalMarketId,
        eventName: externalMarket.eventName,
        homeTeam: externalMarket.homeTeam,
        awayTeam: externalMarket.awayTeam,
        homeTeamId: externalMarket.homeTeamId,
        awayTeamId: externalMarket.awayTeamId,
        league: externalMarket.league,
        sport: externalMarket.sport,
        startsAt: externalMarket.startsAt,
        question: externalMarket.question,
        subtitle: externalMarket.subtitle,
        sourceUrl: externalMarket.sourceUrl,
        outcomes: mergedOutcomes,
        winningOutcome: externalMarket.winningOutcome,
        resolvedValue: externalMarket.resolvedValue,
        status: externalMarket.winningOutcome ? "settled" : externalMarket.status,
        settledAt: externalMarket.winningOutcome ? (externalMarket.settledAt ?? existing?.settledAt ?? new Date()) : null,
      } as const;

      if (existing) {
        await db
          .update(sportPolyMarketsTable)
          .set(values)
          .where(eq(sportPolyMarketsTable.id, existing.id));
      } else {
        await db.insert(sportPolyMarketsTable).values(values);
      }
    }

    lastSuccessfulSyncAt = Date.now();
    await settleResolvedSportsPolyMarkets();
  })()
    .catch((err) => {
      logger.warn({ err }, "Sports Poly market sync failed");
    })
    .finally(() => {
      activeSync = null;
    });

  return activeSync;
}

export async function listSportsPolyMarkets(): Promise<(typeof sportPolyMarketsTable.$inferSelect)[]> {
  await getOrSyncSportsPolyMarkets();

  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 6);

  const activeStart = new Date(Date.now() - 5 * 86_400_000);
  const markets = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(gte(sportPolyMarketsTable.startsAt, windowStart))
    .orderBy(sportPolyMarketsTable.startsAt, sportPolyMarketsTable.eventName);

  const sorted = [...markets]
    .filter((market) =>
      market.startsAt >= windowStart &&
      market.startsAt < windowEnd &&
      market.externalMarketId.startsWith("group:"),
    )
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "open" ? -1 : 1;
      if (left.startsAt.getTime() !== right.startsAt.getTime()) {
        return left.startsAt.getTime() - right.startsAt.getTime();
      }

      return left.eventName.localeCompare(right.eventName);
    });

  const openMarkets = sorted
    .filter((market) =>
      market.status === "open" &&
      market.startsAt >= activeStart &&
      latestPolymarketRelevance.has(market.externalMarketId),
    )
    .slice(0, 200);
  const settledMarkets = sorted.filter((market) => market.status === "settled").slice(0, 150);
  return [...openMarkets, ...settledMarkets].map((market) => ({
    ...market,
    sport: normalizeStoredSport(
      market.sport,
      market.league,
      market.eventName,
      market.question,
      market.sourceUrl,
    ),
  }));
}

export async function settleSportsPolyMarket(marketId: number): Promise<void> {
  const [market] = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(eq(sportPolyMarketsTable.id, marketId))
    .limit(1);

  if (!market) return;

  const winningOutcome = getWinningOutcome(market);
  if (!winningOutcome) return;

  const paidBets = await db
    .select()
    .from(sportPolyBetsTable)
    .where(and(eq(sportPolyBetsTable.marketId, marketId), eq(sportPolyBetsTable.status, "paid")));

  if (paidBets.length === 0) {
    await db
      .update(sportPolyMarketsTable)
      .set({
        status: "settled",
        winningOutcome,
        resolvedValue: market.resolvedValue ?? market.question,
        settledAt: market.settledAt ?? new Date(),
      })
      .where(eq(sportPolyMarketsTable.id, marketId));
    return;
  }

  const winnerBets = paidBets.filter((bet) => bet.direction === winningOutcome);
  const totalPool = paidBets.reduce((sum, bet) => sum + bet.amountSats, 0);
  const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE));
  const totalWinnerStake = winnerBets.reduce((sum, bet) => sum + bet.amountSats, 0);

  for (const bet of paidBets) {
    const isWinner = bet.direction === winningOutcome && totalWinnerStake > 0;
    const payoutSats = isWinner
      ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
      : null;

    await db
      .update(sportPolyBetsTable)
      .set({
        status: isWinner ? "won" : "lost",
        payoutSats,
        ...(isWinner ? { withdrawToken: bet.withdrawToken ?? randomUUID(), withdrawStatus: "unclaimed" } : {}),
      })
      .where(eq(sportPolyBetsTable.id, bet.id));
  }

  await db
    .update(sportPolyBetsTable)
    .set({ status: "expired" })
    .where(and(eq(sportPolyBetsTable.marketId, marketId), eq(sportPolyBetsTable.status, "pending")));

  await db
    .update(sportPolyMarketsTable)
    .set({
      status: "settled",
      winningOutcome,
      resolvedValue: market.resolvedValue ?? market.question,
      settledAt: market.settledAt ?? new Date(),
    })
    .where(eq(sportPolyMarketsTable.id, marketId));
}

export async function settleResolvedSportsPolyMarkets(): Promise<void> {
  const markets = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(eq(sportPolyMarketsTable.provider, "polymarket"));

  for (const market of markets) {
    if (!getWinningOutcome(market)) continue;
    await settleSportsPolyMarket(market.id).catch((err) =>
      logger.warn({ err, marketId: market.id }, "Sports Poly settlement error"),
    );
  }
}

export async function runSportsPolySettlementCycle(): Promise<void> {
  await getOrSyncSportsPolyMarkets(true);
}

export async function addToSportsPolyPool(
  marketId: number,
  outcomeKey: string,
  amountSats: number,
): Promise<void> {
  const [market] = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(eq(sportPolyMarketsTable.id, marketId))
    .limit(1);

  if (!market) throw new Error(`Sports Poly market ${marketId} not found`);

  const outcomes = normalizeMarketOutcomes(market.outcomes);
  const updated = outcomes.map((outcome) =>
    outcome.key === outcomeKey
      ? { ...outcome, poolSats: outcome.poolSats + amountSats }
      : outcome,
  );

  await db
    .update(sportPolyMarketsTable)
    .set({ outcomes: updated })
    .where(eq(sportPolyMarketsTable.id, marketId));
}

export function getOutcomeForSportsPolyMarket(
  market: typeof sportPolyMarketsTable.$inferSelect,
  outcomeKey: string,
): SportPolyOutcomeRecord | null {
  return normalizeMarketOutcomes(market.outcomes).find((outcome) => outcome.key === outcomeKey) ?? null;
}
