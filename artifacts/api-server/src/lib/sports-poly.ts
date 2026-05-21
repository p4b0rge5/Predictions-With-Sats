import {
  db,
  sportPolyBetsTable,
  sportPolyMarketsTable,
  type SportPolyOutcomeRecord,
} from "@workspace/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  fetchPolymarketSportsMarkets,
  normalizeStoredSport,
  type ExternalSportPolyMarket,
} from "./polymarket-sports";
import { logger } from "./logger";
import { publishSportsPolyMarketCreated } from "./nostr-publisher";

const PLATFORM_FEE = 0.02;
const SYNC_TTL_MS = 15 * 60 * 1000;

let lastSuccessfulSyncAt = 0;
let activeSync: Promise<void> | null = null;
let latestPolymarketRelevance = new Map<string, number>();

function normalizeMarketOutcomes(raw: unknown): SportPolyOutcomeRecord[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];

    const candidate = item as Partial<SportPolyOutcomeRecord>;
    if (
      typeof candidate.key !== "string" ||
      typeof candidate.label !== "string"
    )
      return [];

    return [
      {
        key: candidate.key,
        label: candidate.label,
        price:
          typeof candidate.price === "number" &&
          Number.isFinite(candidate.price)
            ? candidate.price
            : null,
        poolSats:
          typeof candidate.poolSats === "number" &&
          Number.isFinite(candidate.poolSats)
            ? candidate.poolSats
            : 0,
        isWinner:
          typeof candidate.isWinner === "boolean" ? candidate.isWinner : null,
        sourceMarketId:
          typeof candidate.sourceMarketId === "string"
            ? candidate.sourceMarketId
            : undefined,
        sortOrder:
          typeof candidate.sortOrder === "number" &&
          Number.isFinite(candidate.sortOrder)
            ? candidate.sortOrder
            : undefined,
      },
    ];
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
    poolSats:
      existingByKey.get(outcome.sourceMarketId ?? outcome.key)?.poolSats ?? 0,
  }));
}

function getWinningOutcome(
  market: typeof sportPolyMarketsTable.$inferSelect,
): string | null {
  return market.winningOutcome ?? null;
}
/** Periods that indicate the game is in progress (not final). */ const IN_PLAY_PERIODS =
  new Set([
    "1H",
    "1st",
    "Q1",
    "Q2",
    "Q3",
    "Q4",
    "2H",
    "2nd",
    "3rd",
    "4th",
    "5th",
    "6th",
    "7th",
    "8th",
    "9th",
    "10th",
    "11th",
    "12th",
    "13th",
    "14th",
    "15th",
    "HT",
    "BTH",
    "BT",
    "ET",
    "INT",
    "LIVE",
    "IN",
    "Top",
    "Bot",
    "END",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
  ]);
/** Detect if a market should be live based on period + scores. */ function isInPlay(
  period: string | null | undefined,
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
): boolean {
  if (!period) return false;
  const p = typeof period === "string" ? period.trim().toUpperCase() : "";
  if (/^FT$|^VFT$|^FINAL$|^FULL$/.test(p)) return false;
  if (homeScore === null && awayScore === null) return false;
  return IN_PLAY_PERIODS.has(p);
}

// Kick off sync but NEVER block the caller unless `block=true`.
export async function getOrSyncSportsPolyMarkets({
  force = false,
  block = false,
} = {}): Promise<void> {
  if (!force && Date.now() - lastSuccessfulSyncAt < SYNC_TTL_MS) return;
  if (activeSync) {
    if (force && block) return activeSync;
    return;
  }

  activeSync = (async () => {
    const externalMarkets = await fetchPolymarketSportsMarkets();
    latestPolymarketRelevance = new Map(
      externalMarkets.map((market, index) => [
        market.externalMarketId,
        market.relevanceRank ?? index,
      ]),
    );

    for (const externalMarket of externalMarkets) {
      const [existing] = await db
        .select()
        .from(sportPolyMarketsTable)
        .where(
          eq(
            sportPolyMarketsTable.externalMarketId,
            externalMarket.externalMarketId,
          ),
        )
        .limit(1);

      const mergedOutcomes = mergeOutcomePools(
        externalMarket.outcomes,
        normalizeMarketOutcomes(existing?.outcomes),
      );
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
        winningOutcome:
          existing?.status === "settled" || existing?.status === "live"
            ? (existing.winningOutcome ?? externalMarket.winningOutcome)
            : externalMarket.winningOutcome,
        resolvedValue:
          existing?.status === "settled" || existing?.status === "live"
            ? (existing.resolvedValue ?? externalMarket.resolvedValue)
            : externalMarket.resolvedValue,
        status:
          existing?.status === "settled"
            ? "settled"
            : externalMarket.winningOutcome
              ? "settled"
              : (externalMarket.status as string) === "live"
                ? "live"
                : existing?.status === "live"
                  ? "live"
                  : isInPlay(
                        externalMarket.period ?? existing?.period,
                        externalMarket.homeScore ?? existing?.homeScore,
                        externalMarket.awayScore ?? existing?.awayScore,
                      )
                    ? "live"
                    : externalMarket.status,
        settledAt: externalMarket.winningOutcome
          ? (externalMarket.settledAt ?? new Date())
          : (existing?.settledAt ?? null),
        homeScore: externalMarket.homeScore ?? existing?.homeScore ?? null,
        awayScore: externalMarket.awayScore ?? existing?.awayScore ?? null,
      } as const;

      if (existing) {
        await db
          .update(sportPolyMarketsTable)
          .set(values)
          .where(eq(sportPolyMarketsTable.id, existing.id));
      } else {
        const [newMarket] = await db
          .insert(sportPolyMarketsTable)
          .values(values)
          .returning();

        publishSportsPolyMarketCreated({
          id: newMarket.id,
          homeTeam: newMarket.homeTeam,
          awayTeam: newMarket.awayTeam,
          league: newMarket.league,
          sport: newMarket.sport,
          startsAt: newMarket.startsAt,
          question: newMarket.question,
          outcomes: mergedOutcomes.map((o) => ({
            key: o.key,
            label: o.label,
            price: o.price,
            poolSats: o.poolSats,
          })),
        }).catch((err) =>
          logger.warn(
            { err, marketId: newMarket.id },
            "Nostr publish failed for new sports-poly market",
          ),
        );
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

  // Block only if explicitly requested (e.g. cron job)
  if (force && block) return activeSync;
  // Otherwise: fire-and-forget — don't await
}

export interface ListSportsPolyOptions {
  /** Filter by sport name: "Soccer", "Basketball", etc. */
  sportFilter?: string;
  /** "today" = 24h window, "week" (default) = 7 days */
  window?: "today" | "week";
}

export async function listSportsPolyMarkets(
  opts: ListSportsPolyOptions = {},
): Promise<(typeof sportPolyMarketsTable.$inferSelect)[]> {
  // Start sync in background — don't block on it
  getOrSyncSportsPolyMarkets();

  const { sportFilter, window: windowMode = "week" } = opts;

  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  if (windowMode === "today") {
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
  } else {
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 6);
  }

  const activeStart = new Date(Date.now() - 5 * 86_400_000);
  const settledSince = new Date(Date.now() - 7 * 86_400_000);

  // Open + live markets filtered by extended startsAt window (5 days back to catch live games that started yesterday)
  const openConditions = [
    gte(sportPolyMarketsTable.startsAt, new Date(windowStart.getTime() - 5 * 86_400_000)),
    lte(sportPolyMarketsTable.startsAt, windowEnd),
  ];

  // Settled markets filtered by settledAt (last 7 days)
  const settledConditions = [
    eq(sportPolyMarketsTable.status, "settled"),
    gte(sportPolyMarketsTable.settledAt, settledSince),
  ];

  if (sportFilter) {
    openConditions.push(eq(sportPolyMarketsTable.sport, sportFilter));
    settledConditions.push(eq(sportPolyMarketsTable.sport, sportFilter));
  }

  // Fetch both sets in parallel
  const [openResults, settledResults] = await Promise.all([
    db
      .select()
      .from(sportPolyMarketsTable)
      .where(and(...openConditions))
      .orderBy(sportPolyMarketsTable.startsAt, sportPolyMarketsTable.eventName),
    db
      .select()
      .from(sportPolyMarketsTable)
      .where(and(...settledConditions))
      .orderBy(sportPolyMarketsTable.settledAt)
      .limit(200),
  ]);

  const openMarkets = [...openResults]
    .filter((market) => market.externalMarketId.startsWith("group:"))
    .filter((market) => {
      if (market.status === "settled") return false;
      return (market.status === "open" || market.status === "live") && market.startsAt >= activeStart;
    });

  const settledMarkets = [...settledResults]
    .filter((market) => market.externalMarketId.startsWith("group:"));

  // Merge and sort: live first, then open (newest first), then settled (newest first)
  const all = [...openMarkets, ...settledMarkets];
  all.sort((left, right) => {
    const tier: Record<string, number> = { live: 0, open: 1, settled: 2 };
    if ((tier[left.status] ?? 3) !== (tier[right.status] ?? 3))
      return (tier[left.status] ?? 3) - (tier[right.status] ?? 3);
    if (left.startsAt.getTime() !== right.startsAt.getTime()) {
    // Newest first within each tier
      return right.startsAt.getTime() - left.startsAt.getTime();
    }
    return left.eventName.localeCompare(right.eventName);
  });

  return all.map((market) => ({
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
    .where(
      and(
        eq(sportPolyBetsTable.marketId, marketId),
        eq(sportPolyBetsTable.status, "paid"),
      ),
    );

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
  const totalWinnerStake = winnerBets.reduce(
    (sum, bet) => sum + bet.amountSats,
    0,
  );

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
        ...(isWinner
          ? {
              withdrawToken: bet.withdrawToken ?? randomUUID(),
              withdrawStatus: "unclaimed",
            }
          : {}),
      })
      .where(eq(sportPolyBetsTable.id, bet.id));
  }

  await db
    .update(sportPolyBetsTable)
    .set({ status: "expired" })
    .where(
      and(
        eq(sportPolyBetsTable.marketId, marketId),
        eq(sportPolyBetsTable.status, "pending"),
      ),
    );

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
  await getOrSyncSportsPolyMarkets({ force: true, block: true });
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
  return (
    normalizeMarketOutcomes(market.outcomes).find(
      (outcome) => outcome.key === outcomeKey,
    ) ?? null
  );
}
