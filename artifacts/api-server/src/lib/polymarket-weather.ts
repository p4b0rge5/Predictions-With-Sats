import { logger } from "./logger";

const GAMMA_API_BASE = process.env.POLYMARKET_GAMMA_API_BASE ?? "https://gamma-api.polymarket.com";
const WEATHER_TAG_SLUG = process.env.POLYMARKET_WEATHER_TAG_SLUG ?? "weather";
const PAGE_LIMIT = 100;
const MAX_ACTIVE_PAGES = 8;
const MAX_CLOSED_PAGES = 4;
const RECENT_PAST_DAYS = 7;
const FUTURE_DAYS = 7;

export interface ExternalWeatherOutcome {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
  sourceMarketId?: string;
  sortOrder?: number;
}

export interface ExternalWeatherMarket {
  externalMarketId: string;
  question: string;
  subtitle: string | null;
  city: string;
  country: string;
  date: string;
  relevanceRank?: number;
  threshold: number | null;
  status: "open" | "settled";
  winningOutcome: string | null;
  resolvedValue: string | null;
  sourceUrl: string | null;
  settledAt: Date | null;
  outcomes: ExternalWeatherOutcome[];
}

interface PolymarketTokenLike {
  outcome?: unknown;
  price?: unknown;
  winner?: unknown;
}

interface PolymarketMarketLike {
  id?: unknown;
  slug?: unknown;
  question?: unknown;
  title?: unknown;
  description?: unknown;
  subtitle?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  tokens?: unknown;
  endDate?: unknown;
  end_date_iso?: unknown;
  gameStartTime?: unknown;
  closedTime?: unknown;
  updatedAt?: unknown;
  volume?: unknown;
  volume24hr?: unknown;
  liquidity?: unknown;
  competitive?: unknown;
}

interface GroupableWeatherMarket {
  sourceMarketId: string;
  sourceUrl: string | null;
  city: string;
  date: string;
  threshold: number | null;
  outcomeLabel: string;
  subtitle: string | null;
  yesPrice: number | null;
  resolvedTruth: boolean | null;
  settledAt: Date | null;
  sourceRank: number;
  relevanceCompetitive: number | null;
  relevanceVolume24hr: number | null;
  relevanceLiquidity: number | null;
  relevanceVolume: number | null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePercent(value: unknown): number | null {
  const num = asNumber(value);
  if (num === null) return null;
  return num <= 1 ? num * 100 : num;
}

function toDateString(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function tryParseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseQuestionDate(dateText: string, raw: PolymarketMarketLike): string | null {
  const explicit = new Date(dateText.trim());
  if (!Number.isNaN(explicit.getTime()) && explicit.getUTCFullYear() > 2001) {
    return toDateString(explicit.toISOString());
  }

  const reference =
    asString(raw.endDate) ??
    asString(raw.end_date_iso) ??
    asString(raw.gameStartTime) ??
    null;
  if (!reference) return null;

  const referenceDate = new Date(reference);
  if (Number.isNaN(referenceDate.getTime())) return null;

  const withYear = new Date(`${dateText.trim()}, ${referenceDate.getUTCFullYear()}`);
  return Number.isNaN(withYear.getTime()) ? null : toDateString(withYear.toISOString());
}

function getTokenPairs(raw: PolymarketMarketLike): Array<{ label: string; price: number | null; winner: boolean | null }> {
  if (Array.isArray(raw.tokens) && raw.tokens.length > 0) {
    return (raw.tokens as PolymarketTokenLike[]).flatMap((token) => {
      const label = asString(token.outcome);
      if (!label) return [];
      return [{
        label,
        price: normalizePercent(token.price),
        winner: token.winner === true ? true : token.winner === false ? false : null,
      }];
    });
  }

  const labels = tryParseJsonArray(raw.outcomes)
    .map((value) => asString(value))
    .filter((value): value is string => value !== null);
  const prices = tryParseJsonArray(raw.outcomePrices);

  return labels.map((label, index) => ({
    label,
    price: normalizePercent(prices[index]),
    winner: null,
  }));
}

function getYesInfo(raw: PolymarketMarketLike): { yesPrice: number | null; resolvedTruth: boolean | null } | null {
  const pairs = getTokenPairs(raw);
  if (pairs.length < 2) return null;

  const yes = pairs.find((pair) => pair.label.toLowerCase() === "yes");
  const no = pairs.find((pair) => pair.label.toLowerCase() === "no");
  if (!yes || !no) return null;

  const resolvedTruth =
    yes.winner === true ? true :
    no.winner === true ? false :
    yes.price !== null && yes.price >= 99 ? true :
    no.price !== null && no.price >= 99 ? false :
    null;

  return {
    yesPrice: yes.price,
    resolvedTruth,
  };
}

function parseCityAndDate(question: string, raw: PolymarketMarketLike): { city: string; date: string | null; outcomeLabel: string | null } {
  const pattern = /(?:will\s+the\s+)?(?:(?:highest|max(?:imum)?)\s+temperature)\s+in\s+(.+?)\s+be\s+(.+?)\s+on\s+(.+?)(?:\?|$)/i;
  const match = question.match(pattern);
  if (match) {
    return {
      city: match[1].trim(),
      outcomeLabel: match[2].trim(),
      date: parseQuestionDate(match[3].trim(), raw),
    };
  }

  const fallbackDate =
    asString(raw.endDate) ??
    asString(raw.end_date_iso) ??
    asString(raw.gameStartTime) ??
    null;

  return {
    city: question.replace(/\?$/, "").trim(),
    outcomeLabel: null,
    date: fallbackDate ? toDateString(fallbackDate) : null,
  };
}

function inferThreshold(label: string): number | null {
  const match = label.match(/(\d+(?:\.\d+)?)\s*°\s*([CF])?/i);
  return match ? Number(match[1]) : null;
}

function isSupportedWeatherQuestion(question: string): boolean {
  return /(?:(?:highest|max(?:imum)?)\s+temperature)/i.test(question) && /\son\s/i.test(question);
}

function toAbsolutePolymarketUrl(slug: string | null): string | null {
  return slug ? `https://polymarket.com/event/${slug}` : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Polymarket HTTP ${res.status} for ${url}`);
  }

  return res.json() as Promise<T>;
}

async function fetchWeatherMarketBatch(
  tagId: string | null,
  offset: number,
  options: {
    active?: boolean;
    closed?: boolean;
    order?: "volume_24hr" | "volume" | "liquidity" | "start_date" | "end_date" | "competitive" | "closed_time";
    ascending?: boolean;
  },
): Promise<unknown[] | null> {
  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));
  if (tagId) url.searchParams.set("tag_id", tagId);
  if (options.active !== undefined) url.searchParams.set("active", String(options.active));
  if (options.closed !== undefined) url.searchParams.set("closed", String(options.closed));
  if (options.order) url.searchParams.set("order", options.order);
  if (options.ascending !== undefined) url.searchParams.set("ascending", String(options.ascending));

  const batch = await fetchJson<unknown>(url.toString());
  return Array.isArray(batch) ? batch : null;
}

let weatherTagIdCache: string | null = null;

async function getWeatherTagId(): Promise<string | null> {
  if (weatherTagIdCache) return weatherTagIdCache;

  try {
    const tag = await fetchJson<{ id?: unknown }>(`${GAMMA_API_BASE}/tags/slug/${WEATHER_TAG_SLUG}`);
    const tagId = asString(tag.id);
    weatherTagIdCache = tagId;
    return tagId;
  } catch (err) {
    logger.warn({ err }, "Failed to resolve Polymarket weather tag id");
    return null;
  }
}

function withinDateWindow(date: string | null): boolean {
  if (!date) return false;

  const now = new Date();
  const min = new Date(now.getTime() - RECENT_PAST_DAYS * 86_400_000).toISOString().slice(0, 10);
  const max = new Date(now.getTime() + FUTURE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return date >= min && date <= max;
}

function normalizeIndividualMarket(raw: PolymarketMarketLike, sourceRank: number): GroupableWeatherMarket | null {
  const question = asString(raw.question) ?? asString(raw.title);
  const sourceMarketId = asString(raw.id);
  if (!question || !sourceMarketId || !isSupportedWeatherQuestion(question)) return null;

  const yesInfo = getYesInfo(raw);
  if (!yesInfo) return null;

  const { city, date, outcomeLabel } = parseCityAndDate(question, raw);
  if (!withinDateWindow(date) || !outcomeLabel) return null;

  const settledAt = yesInfo.resolvedTruth !== null
    ? new Date(
        asString(raw.closedTime) ??
          asString(raw.updatedAt) ??
          asString(raw.endDate) ??
          new Date().toISOString(),
      )
    : null;

  return {
    sourceMarketId,
    sourceUrl: toAbsolutePolymarketUrl(asString(raw.slug)),
    city,
    date: date!,
    threshold: inferThreshold(outcomeLabel),
    outcomeLabel,
    subtitle: asString(raw.subtitle) ?? asString(raw.description),
    yesPrice: yesInfo.yesPrice,
    resolvedTruth: yesInfo.resolvedTruth,
    settledAt,
    sourceRank,
    relevanceCompetitive: asNumber(raw.competitive),
    relevanceVolume24hr: asNumber(raw.volume24hr),
    relevanceLiquidity: asNumber(raw.liquidity),
    relevanceVolume: asNumber(raw.volume),
  };
}

function compareOutcomeOrder(a: GroupableWeatherMarket, b: GroupableWeatherMarket): number {
  const thresholdA = a.threshold ?? Number.POSITIVE_INFINITY;
  const thresholdB = b.threshold ?? Number.POSITIVE_INFINITY;
  if (thresholdA !== thresholdB) return thresholdA - thresholdB;

  const belowA = /below/i.test(a.outcomeLabel) ? -1 : /higher/i.test(a.outcomeLabel) ? 1 : 0;
  const belowB = /below/i.test(b.outcomeLabel) ? -1 : /higher/i.test(b.outcomeLabel) ? 1 : 0;
  if (belowA !== belowB) return belowA - belowB;

  return a.outcomeLabel.localeCompare(b.outcomeLabel);
}

function buildGroupedQuestion(city: string, date: string): string {
  return `What will the highest temperature in ${city} be on ${date}?`;
}

function getGroupedMarketRelevance(items: GroupableWeatherMarket[]): {
  volume: number;
  liquidity: number;
  competitive: number;
  sourceRank: number;
} {
  return items.reduce((best, item) => ({
    volume: Math.max(best.volume, item.relevanceVolume ?? 0),
    liquidity: Math.max(best.liquidity, item.relevanceLiquidity ?? 0),
    competitive: Math.max(best.competitive, item.relevanceCompetitive ?? 0),
    sourceRank: Math.min(best.sourceRank, item.sourceRank),
  }), {
    volume: 0,
    liquidity: 0,
    competitive: 0,
    sourceRank: Number.POSITIVE_INFINITY,
  });
}

function compareGroupedMarketRelevance(a: GroupableWeatherMarket[], b: GroupableWeatherMarket[]): number {
  const left = getGroupedMarketRelevance(a);
  const right = getGroupedMarketRelevance(b);

  if (left.volume !== right.volume) return right.volume - left.volume;
  if (left.liquidity !== right.liquidity) return right.liquidity - left.liquidity;
  if (left.competitive !== right.competitive) return right.competitive - left.competitive;
  if (left.sourceRank !== right.sourceRank) return left.sourceRank - right.sourceRank;

  const leftDate = a[0]?.date ?? "";
  const rightDate = b[0]?.date ?? "";
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  return (a[0]?.city ?? "").localeCompare(b[0]?.city ?? "");
}

function toGroupedMarket(items: GroupableWeatherMarket[], relevanceRank: number): ExternalWeatherMarket {
  const sorted = [...items].sort(compareOutcomeOrder);
  const first = sorted[0];
  const groupId = `group:${slugify(first.city)}:${first.date}`;
  const outcomes = sorted.map((item, index) => ({
    key: slugify(item.outcomeLabel),
    label: item.outcomeLabel,
    price: item.yesPrice,
    poolSats: 0,
    isWinner: item.resolvedTruth === null ? null : item.resolvedTruth,
    sourceMarketId: item.sourceMarketId,
    sortOrder: index,
  }));
  const winner = outcomes.find((outcome) => outcome.isWinner === true) ?? null;
  const settledAt = winner
    ? sorted.find((item) => slugify(item.outcomeLabel) === winner.key)?.settledAt ?? null
    : null;

  return {
    externalMarketId: groupId,
    question: buildGroupedQuestion(first.city, first.date),
    subtitle: first.subtitle,
    city: first.city,
    country: "",
    date: first.date,
    relevanceRank,
    threshold: null,
    status: winner ? "settled" : "open",
    winningOutcome: winner?.key ?? null,
    resolvedValue: winner?.label ?? null,
    sourceUrl: first.sourceUrl,
    settledAt,
    outcomes,
  };
}

export async function fetchPolymarketWeatherMarkets(): Promise<ExternalWeatherMarket[]> {
  const tagId = await getWeatherTagId();
  const grouped = new Map<string, GroupableWeatherMarket[]>();
  const seenSourceMarketIds = new Set<string>();
  let sourceRank = 0;

  const collectBatch = (batch: unknown[]) => {
    for (const item of batch) {
      const market = normalizeIndividualMarket(item as PolymarketMarketLike, sourceRank);
      sourceRank += 1;
      if (!market || seenSourceMarketIds.has(market.sourceMarketId)) continue;
      seenSourceMarketIds.add(market.sourceMarketId);
      const key = `${market.city}::${market.date}`;
      const list = grouped.get(key) ?? [];
      list.push(market);
      grouped.set(key, list);
    }
  };

  for (let page = 0; page < MAX_ACTIVE_PAGES; page += 1) {
    const offset = page * PAGE_LIMIT;

    let batch: unknown[] | null;
    try {
      batch = await fetchWeatherMarketBatch(tagId, offset, {
        active: true,
        closed: false,
        order: "end_date",
        ascending: true,
      });
    } catch (err) {
      logger.warn({ err, page }, "Failed to fetch active Polymarket weather markets");
      break;
    }

    if (!batch || batch.length === 0) break;
    collectBatch(batch);
    if (batch.length < PAGE_LIMIT) break;
  }

  for (let page = 0; page < MAX_CLOSED_PAGES; page += 1) {
    const offset = page * PAGE_LIMIT;

    let batch: unknown[] | null;
    try {
      batch = await fetchWeatherMarketBatch(tagId, offset, {
        closed: true,
        order: "closed_time",
        ascending: false,
      });
    } catch (err) {
      logger.warn({ err, page }, "Failed to fetch closed Polymarket weather markets");
      break;
    }

    if (!batch || batch.length === 0) break;
    collectBatch(batch);
    if (batch.length < PAGE_LIMIT) break;
  }

  return Array.from(grouped.values())
    .filter((items) => items.length >= 2)
    .sort(compareGroupedMarketRelevance)
    .map((items, index) => toGroupedMarket(items, index));
}
