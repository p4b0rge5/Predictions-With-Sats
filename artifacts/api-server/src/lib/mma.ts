/**
 * MMA data — powered by api-sports.io MMA API
 *
 * Base URL: https://v1.mma.api-sports.io
 * Same API key as other api-sports.io APIs (x-apisports-key header).
 *
 * MMA has NO draws in our betting system — if a fight ends in a technical draw
 * the market remains unsettled and is handled manually.
 * Event IDs are prefixed with "mma_" to avoid collision with other sport IDs.
 *
 * Free plan: 100 req/day (separate quota from other api-sports.io APIs).
 * Request budget: today + tomorrow + yesterday = 3 req per refresh (30-min TTL → ~144/day →
 *   cap at 30-min TTL to stay under 100 req/day: 3 req/refresh × 33 refreshes = 99 req/day max).
 *
 * No off-season guard: MMA events (UFC, Bellator, ONE Championship, PFL) run year-round.
 *
 * Settlement duration: 360 min (main cards start ~7pm ET and can run until midnight with prelims).
 */

import { logger } from "./logger";
import type { SportEvent } from "./sports";

const API_MMA_BASE = "https://v1.mma.api-sports.io";
const API_MMA_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// Major promotions — league IDs on api-sports.io MMA API
const MMA_UFC_ID      = 1;  // UFC
const MMA_BELLATOR_ID = 2;  // Bellator
const MMA_ONE_ID      = 9;  // ONE Championship
const MMA_PFL_ID      = 10; // PFL
const MMA_LEAGUE_IDS  = new Set([MMA_UFC_ID, MMA_BELLATOR_ID, MMA_ONE_ID, MMA_PFL_ID]);

// ---------------------------------------------------------------------------
// Types — MMA API response format
// ---------------------------------------------------------------------------

interface MmaFight {
  id: number;
  date: string;        // "2024-03-09T23:00:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  season: number;
  status: {
    short:  string;    // "NS","FT","LIVE","CANC","POST","SUSP"
    long:   string;
    timer:  string | null;
  };
  league: {
    id:     number;
    name:   string;
    season: number;
    logo:   string;
    country?: { name: string; code: string; flag: string };
  };
  fighters: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  scores?: {
    home?: { total: number | null };
    away?: { total: number | null };
  };
  winner?: { id: number; name: string } | null;
  result?: {
    winner: "home" | "away" | null;
    end:    string | null;  // "KO/TKO", "Submission", "Decision", "Draw", etc.
    round:  number | null;
    time:   string | null;
  } | null;
}

interface MmaApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: MmaFight[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

const FINISHED_STATUSES = new Set(["FT", "FT OT", "AOT", "WO", "AW"]);
const NOT_STARTED_STATUSES = new Set(["NS", "POST", "CANC", "ABD", "SUSP"]);

function parseMmaStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED_STATUSES.has(s)) return "finished";
  if (NOT_STARTED_STATUSES.has(s)) return "upcoming";
  return "live";
}

function parseMmaOutcome(fight: MmaFight): SportEvent["outcome"] {
  // Prefer explicit result.winner from API
  if (fight.result?.winner === "home") return "home";
  if (fight.result?.winner === "away") return "away";
  // Fallback to winner object
  if (fight.winner) {
    if (fight.winner.id === fight.fighters.home.id) return "home";
    if (fight.winner.id === fight.fighters.away.id) return "away";
  }
  // Fallback to scores
  const h = fight.scores?.home?.total ?? null;
  const a = fight.scores?.away?.total ?? null;
  if (h !== null && a !== null) {
    if (h > a) return "home";
    if (a > h) return "away";
  }
  return null;
}

function mapFight(f: MmaFight): SportEvent {
  const status = parseMmaStatus(f.status.short);
  const h = f.scores?.home?.total ?? null;
  const a = f.scores?.away?.total ?? null;
  const leagueName = f.league.name ?? "MMA";
  // Build a descriptive event name: "Jon Jones vs Stipe Miocic"
  const event = `${f.fighters.home.name} vs ${f.fighters.away.name}`;
  return {
    id:         `mma_${f.id}`,
    event,
    homeTeam:   f.fighters.home.name,
    awayTeam:   f.fighters.away.name,
    homeBadge:  f.fighters.home.logo || null,
    awayBadge:  f.fighters.away.logo || null,
    leagueLogo: f.league.logo || null,
    league:     leagueName,
    sport:      "MMA",
    country:    f.league.country?.name ?? "USA",
    startsAt:   f.date,
    status,
    homeScore:  h,
    awayScore:  a,
    outcome:    status === "finished" ? parseMmaOutcome(f) : null,
    elapsed:    typeof f.status.timer === "string" ? parseInt(f.status.timer, 10) || null : null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function mmaFetch(path: string): Promise<MmaApiResponse> {
  if (!API_MMA_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping MMA API request");
    return { errors: [], results: 0, response: [] };
  }
  const url = `${API_MMA_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_MMA_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`MMA API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<MmaApiResponse>;
}

function hasErrors(errors: MmaApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Cache (30-min TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS              = 30 * 60 * 1000;   // 30 min
const CACHE_ERROR_TTL_MS        = 15 * 60 * 1000;
const MAX_FIGHT_AGE_MS          = 7 * 60 * 60 * 1000; // MMA events run up to 7h with prelims
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const mmaCache: {
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], finished: [], fetchedAt: 0, suspended: false };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getMmaEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - mmaCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  mmaCache.upcoming,
      finished:  mmaCache.finished,
      suspended: mmaCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "MMA cache force-refreshed for settlement");
  }

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const today     = toDateStr(new Date());
  const tomorrow  = toDateStr(new Date(Date.now() + 86_400_000));
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));

  const [todayData, tomorrowData, yesterdayData] = await Promise.allSettled([
    mmaFetch(`/fights?date=${today}`),
    mmaFetch(`/fights?date=${tomorrow}`),
    mmaFetch(`/fights?date=${yesterday}`),
  ]);

  const allFights: MmaFight[] = [];
  let apiErrored = false;

  for (const result of [todayData, tomorrowData, yesterdayData]) {
    if (result.status === "fulfilled") {
      if (hasErrors(result.value.errors)) {
        logger.warn({ errors: result.value.errors }, "MMA API returned errors");
        apiErrored = true;
      }
      const mmaFights = (result.value.response ?? []).filter(
        (f) => MMA_LEAGUE_IDS.has(f.league.id),
      );
      allFights.push(...mmaFights);
    } else {
      logger.warn({ err: result.reason }, "MMA API date fetch failed");
      apiErrored = true;
    }
  }

  if (apiErrored && allFights.length === 0) {
    mmaCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
    mmaCache.suspended = true;
    logger.warn("MMA API error — serving stale cache, retrying in 15 min");
    return { upcoming: mmaCache.upcoming, finished: mmaCache.finished, suspended: true };
  }

  const mapped = allFights.map(mapFight);
  const now    = Date.now();

  const upcoming = mapped
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      const start = new Date(ev.startsAt).getTime();
      return start > now - MAX_FIGHT_AGE_MS;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const finished = mapped
    .filter((ev) => ev.status === "finished")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 20);

  mmaCache.upcoming  = upcoming;
  mmaCache.finished  = finished;
  mmaCache.fetchedAt = Date.now();
  mmaCache.suspended = false;

  logger.info(
    { upcoming: upcoming.length, finished: finished.length, total: allFights.length },
    "MMA fights refreshed",
  );

  return { upcoming: mmaCache.upcoming, finished: mmaCache.finished, suspended: false };
}

// ---------------------------------------------------------------------------
// Single fight lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchMmaFightById(mmaEventId: string): Promise<SportEvent | null> {
  const fightId = mmaEventId.replace(/^mma_/, "");
  try {
    const data = await mmaFetch(`/fights?id=${fightId}`);
    const f = data.response?.[0];
    if (!f) return null;
    return mapFight(f);
  } catch (err) {
    logger.warn({ err, mmaEventId }, "MMA API fight lookup failed");
    return null;
  }
}
