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
 * Free plan: 100 req/day (separate quota from other api-sports.io APIs), allows only yesterday
 * + today + tomorrow.
 * Request budget: 3-day window → 3 req per refresh (3h TTL → 8 refreshes/day → ~24 req/day).
 *
 * No off-season guard: MMA events (UFC, Bellator, ONE Championship, PFL) run year-round.
 *
 * Settlement duration: 360 min (main cards start ~7pm ET and can run until midnight with prelims).
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import type { SportEvent } from "./sports";

// Free plan only allows yesterday + today + tomorrow (3 days).
// Using 8 days wastes quota and causes plan errors for 5 of the 8 dates.
function getMmaDateWindowStrings(nowMs = Date.now()): string[] {
  const base = new Date(nowMs);
  base.setUTCHours(0, 0, 0, 0);
  return [-1, 0, 1].map((offset) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
}

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

interface MmaFighter {
  id: number;
  name: string;
  logo: string;
  winner: boolean;
}

interface MmaFight {
  id: number;
  date: string;        // "2024-03-09T23:00:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  slug?: string;       // "UFC Fight Night: Burns vs. Malott"
  is_main?: boolean;
  category?: string;   // "Lightweight", "Welterweight", etc.
  season?: number;
  status: {
    short:  string;    // "NS","FT","LIVE","CANC","POST","SUSP"
    long:   string;
    timer?: string | null;
  };
  // New API format uses first/second; old format used home/away inside a league wrapper
  league?: {
    id:     number;
    name:   string;
    season: number;
    logo:   string;
    country?: { name: string; code: string; flag: string };
  };
  fighters: {
    // New API format
    first?:  MmaFighter;
    second?: MmaFighter;
    // Legacy API format
    home?: { id: number; name: string; logo: string };
    away?: { id: number; name: string; logo: string };
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

// Major promotion slugs (substring match) for when league field is absent.
// Order matters: longer names first to avoid "ONE" matching before "ONE Championship".
const MMA_SLUG_KEYWORDS = ["ONE Championship", "UFC Fight Night", "UFC", "Bellator", "PFL"];

// Extracts the promotion label from a slug like "UFC Fight Night: Burns vs. Malott" → "UFC Fight Night"
function promotionFromSlug(slug: string): string {
  for (const kw of MMA_SLUG_KEYWORDS) {
    if (slug.includes(kw)) return kw;
  }
  return slug.split(":")[0]?.trim() ?? slug;
}

function hasSupportedLeague(fight: MmaFight): boolean {
  // New API format: no league field, use slug to identify supported promotions
  if (!fight.league) {
    const slug = fight.slug ?? "";
    return MMA_SLUG_KEYWORDS.some((kw) => slug.includes(kw));
  }
  const leagueId = fight.league.id;
  return typeof leagueId === "number" && MMA_LEAGUE_IDS.has(leagueId);
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
  // Fallback to winner object — support both first/second and home/away layouts
  if (fight.winner) {
    const homeId = (fight.fighters.first ?? fight.fighters.home)?.id;
    const awayId = (fight.fighters.second ?? fight.fighters.away)?.id;
    if (fight.winner.id === homeId) return "home";
    if (fight.winner.id === awayId) return "away";
  }
  // Fallback: check fighters[].winner flag (new API format)
  if (fight.fighters.first?.winner === true) return "home";
  if (fight.fighters.second?.winner === true) return "away";
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

  // Support both new API format (first/second) and legacy format (home/away)
  const homeFighter = f.fighters.first ?? f.fighters.home;
  const awayFighter = f.fighters.second ?? f.fighters.away;

  const leagueName = f.league?.name ?? (f.slug ? promotionFromSlug(f.slug) : "MMA");
  const event = `${homeFighter?.name ?? "?"} vs ${awayFighter?.name ?? "?"}`;

  return {
    id:         `mma_${f.id}`,
    event,
    homeTeam:   homeFighter?.name ?? "TBD",
    awayTeam:   awayFighter?.name ?? "TBD",
    homeBadge:  homeFighter?.logo || null,
    awayBadge:  awayFighter?.logo || null,
    leagueLogo: f.league?.logo || null,
    league:     leagueName,
    sport:      "MMA",
    country:    f.league?.country?.name ?? "USA",
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
  const budget = await reserveSportsRequests("mma", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "mma", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return {
      errors: { budget: "Daily request budget exhausted" },
      results: 0,
      response: [],
    };
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
// Cache (3h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS              = 3 * 60 * 60 * 1000; // 3 hours — keeps daily requests at ~64 (under 100/day budget)
const CACHE_ERROR_TTL_MS        = 15 * 60 * 1000;
const MAX_FIGHT_AGE_MS          = 7 * 60 * 60 * 1000; // MMA events run up to 7h with prelims
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const mmaCache: {
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], live: [], finished: [], fetchedAt: 0, suspended: false };
let refreshPromise: Promise<{ upcoming: SportEvent[]; live: SportEvent[]; finished: SportEvent[]; suspended: boolean }> | null = null;

function normalizeEventStatus(ev: SportEvent, now: number): SportEvent["status"] {
  if (ev.status !== "upcoming") return ev.status;
  const kickoff = new Date(ev.startsAt).getTime();
  if (kickoff <= now && kickoff > now - MAX_FIGHT_AGE_MS) {
    return "live";
  }
  return ev.status;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getMmaEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - mmaCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  mmaCache.upcoming,
      live:      mmaCache.live,
      finished:  mmaCache.finished,
      suspended: mmaCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "MMA cache force-refreshed for settlement");
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const dateWindow = getMmaDateWindowStrings();
    const dateFetches = await Promise.allSettled(
      dateWindow.map((date) => mmaFetch(`/fights?date=${date}`)),
    );

    const allFights: MmaFight[] = [];
    let apiErrored = false;

    for (const result of dateFetches) {
      if (result.status === "fulfilled") {
        if (hasErrors(result.value.errors)) {
          logger.warn({ errors: result.value.errors }, "MMA API returned errors");
          apiErrored = true;
        }
        const mmaFights = (result.value.response ?? []).filter(hasSupportedLeague);
        allFights.push(...mmaFights);
      } else {
        logger.warn({ err: result.reason }, "MMA API date fetch failed");
        apiErrored = true;
      }
    }

    if (apiErrored && allFights.length === 0) {
      mmaCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
      const hasStale = mmaCache.upcoming.length > 0 || mmaCache.live.length > 0 || mmaCache.finished.length > 0;
      mmaCache.suspended = !hasStale;
      logger.warn({ hasStale }, hasStale
        ? "MMA API error — serving stale cache without suspension"
        : "MMA API error — no stale data available, suspending");
      return { upcoming: mmaCache.upcoming, live: mmaCache.live, finished: mmaCache.finished, suspended: mmaCache.suspended };
    }

    const now    = Date.now();
    const mapped = allFights
      .map(mapFight)
      .map((ev) => ({ ...ev, status: normalizeEventStatus(ev, now) }));

    const upcoming = mapped
      .filter((ev) => {
        if (ev.status !== "upcoming") return false;
        const start = new Date(ev.startsAt).getTime();
        return start > now;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const live = mapped
      .filter((ev) => ev.status === "live")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    const finished = mapped
      .filter((ev) => ev.status === "finished")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 20);

    mmaCache.upcoming  = upcoming;
    mmaCache.live      = live;
    mmaCache.finished  = finished;
    mmaCache.fetchedAt = Date.now();
    mmaCache.suspended = false;

    logger.info(
      { upcoming: upcoming.length, live: live.length, finished: finished.length, total: allFights.length },
      "MMA fights refreshed",
    );

    return { upcoming: mmaCache.upcoming, live: mmaCache.live, finished: mmaCache.finished, suspended: false };
  })();
  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  if (!canForce && mmaCache.fetchedAt > 0) {
    return { upcoming: mmaCache.upcoming, live: mmaCache.live, finished: mmaCache.finished, suspended: mmaCache.suspended };
  }

  return refreshPromise;
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
