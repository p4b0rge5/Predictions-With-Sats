/**
 * International Basketball — powered by api-sports.io Basketball API
 *
 * Base URL: https://v1.basketball.api-sports.io  (same endpoint as nba.ts)
 * Same API key as other api-sports.io APIs (x-apisports-key header).
 *
 * This module covers ALL leagues EXCEPT NBA (12) and NBA Playoffs (13),
 * which are handled by nba.ts. This avoids duplicate events between tabs.
 *
 * Basketball has NO draws — outcomes are always "home" or "away" (OT decides ties).
 * Event IDs are prefixed with "basketball_" to avoid collision.
 *
 * NOTE: Both this module and nba.ts consume from the same api-sports.io
 * Basketball API quota (100 req/day). They use separate budget keys so each
 * has its own 100/day ceiling in the tracker, but in practice both draw from
 * the same underlying API limit. Use conservative TTLs to stay within budget.
 *
 * Free plan: 100 req/day (shared with NBA module on api-sports.io side).
 * 3-day window × 3h TTL → ~24 req/day for this module.
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import type { SportEvent } from "./sports";

// Free plan only allows yesterday + today + tomorrow (3 days).
function getBasketballDateWindowStrings(nowMs = Date.now()): string[] {
  const base = new Date(nowMs);
  base.setUTCHours(0, 0, 0, 0);
  return [-1, 0, 1].map((offset) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
}

const API_BASKETBALL_BASE = "https://v1.basketball.api-sports.io";
const API_BASKETBALL_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// Excluded from this module — handled by nba.ts
const NBA_EXCLUDED_LEAGUE_IDS = new Set([12, 13]);

// ---------------------------------------------------------------------------
// Types — Basketball API response format
// ---------------------------------------------------------------------------

interface BasketballGame {
  id: number;
  date: string;
  time: string;
  timestamp: number;
  timezone: string;
  stage: string | null;
  week: string | null;
  venue: string | null;
  status: {
    long:  string;
    short: string;   // "NS","Q1","Q2","Q3","Q4","HT","OT","BT","FT","AOT","POST","CANC","SUSP"
    timer: string | null;
  };
  league: {
    id:     number;
    name:   string;
    type:   string;
    season: string | number;
    logo:   string;
  };
  country: { id: number; name: string; code: string; flag: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  scores: {
    home: { quarter_1: number | null; quarter_2: number | null; quarter_3: number | null; quarter_4: number | null; over_time: number | null; total: number | null };
    away: { quarter_1: number | null; quarter_2: number | null; quarter_3: number | null; quarter_4: number | null; over_time: number | null; total: number | null };
  };
}

interface BasketballApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: BasketballGame[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

const FINISHED_STATUSES = new Set(["FT", "AOT"]);
const LIVE_STATUSES     = new Set(["Q1", "Q2", "Q3", "Q4", "HT", "OT", "BT"]);

function parseBasketballStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED_STATUSES.has(s)) return "finished";
  if (LIVE_STATUSES.has(s))     return "live";
  return "upcoming"; // "NS", "POST", "CANC", "SUSP", etc.
}

function parseBasketballOutcome(homeTotal: number | null, awayTotal: number | null): SportEvent["outcome"] {
  if (homeTotal === null || awayTotal === null) return null;
  if (homeTotal > awayTotal) return "home";
  if (awayTotal > homeTotal) return "away";
  return null; // OT always resolves ties — safety fallback
}

function mapGame(g: BasketballGame): SportEvent {
  const homeScore = g.scores.home.total;
  const awayScore = g.scores.away.total;
  const status    = parseBasketballStatus(g.status.short);
  return {
    id:         `basketball_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    leagueId:   g.league.id,
    league:     g.league.name,
    sport:      "Basketball",
    country:    g.country?.name ?? "Unknown",
    startsAt:   g.date,
    status,
    homeScore,
    awayScore,
    outcome:    status === "finished" ? parseBasketballOutcome(homeScore, awayScore) : null,
    elapsed:    null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function basketballFetch(path: string): Promise<BasketballApiResponse> {
  if (!API_BASKETBALL_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping Basketball API request");
    return { errors: [], results: 0, response: [] };
  }
  const budget = await reserveSportsRequests("basketball", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "basketball", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return { errors: { budget: "Daily request budget exhausted" }, results: 0, response: [] };
  }
  const url = `${API_BASKETBALL_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_BASKETBALL_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Basketball API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<BasketballApiResponse>;
}

function hasErrors(errors: BasketballApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Cache (3h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS              = 3 * 60 * 60 * 1000;
const CACHE_ERROR_TTL_MS        = 15 * 60 * 1000;
const MAX_GAME_AGE_MS           = 4 * 60 * 60 * 1000; // games ~2.5–3.5h with OT
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

function normalizeEventStatus(ev: SportEvent, now: number): SportEvent["status"] {
  if (ev.status !== "upcoming") return ev.status;
  const kickoff = new Date(ev.startsAt).getTime();
  if (kickoff <= now && kickoff > now - MAX_GAME_AGE_MS) return "live";
  return ev.status;
}

const basketballCache: {
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], live: [], finished: [], fetchedAt: 0, suspended: false };
let refreshPromise: Promise<{ upcoming: SportEvent[]; live: SportEvent[]; finished: SportEvent[]; suspended: boolean }> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getBasketballEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - basketballCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  basketballCache.upcoming,
      live:      basketballCache.live,
      finished:  basketballCache.finished,
      suspended: basketballCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "Basketball cache force-refreshed for settlement");
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const dateWindow = getBasketballDateWindowStrings();
    const dateFetches = await Promise.allSettled(
      dateWindow.map((date) => basketballFetch(`/games?date=${date}`)),
    );

    const allGames: BasketballGame[] = [];
    let apiErrored = false;

    for (const result of dateFetches) {
      if (result.status === "fulfilled") {
        if (hasErrors(result.value.errors)) {
          logger.warn({ errors: result.value.errors }, "Basketball API returned errors");
          apiErrored = true;
        }
        const games = (result.value.response ?? []).filter(
          (g) => typeof g.league?.id === "number" && !NBA_EXCLUDED_LEAGUE_IDS.has(g.league.id),
        );
        allGames.push(...games);
      } else {
        logger.warn({ err: result.reason }, "Basketball API date fetch failed");
        apiErrored = true;
      }
    }

    if (apiErrored && allGames.length === 0) {
      basketballCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
      const hasStale = basketballCache.upcoming.length > 0 || basketballCache.live.length > 0 || basketballCache.finished.length > 0;
      basketballCache.suspended = !hasStale;
      logger.warn({ hasStale }, hasStale
        ? "Basketball API error — serving stale cache without suspension"
        : "Basketball API error — no stale data available, suspending");
      return { upcoming: basketballCache.upcoming, live: basketballCache.live, finished: basketballCache.finished, suspended: basketballCache.suspended };
    }

    const now    = Date.now();
    const mapped = allGames
      .map(mapGame)
      .map((ev) => ({ ...ev, status: normalizeEventStatus(ev, now) }));

    const upcoming = mapped
      .filter((ev) => {
        if (ev.status !== "upcoming") return false;
        return new Date(ev.startsAt).getTime() > now;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const live = mapped
      .filter((ev) => ev.status === "live")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    const finished = mapped
      .filter((ev) => ev.status === "finished")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 20);

    basketballCache.upcoming  = upcoming;
    basketballCache.live      = live;
    basketballCache.finished  = finished;
    basketballCache.fetchedAt = Date.now();
    basketballCache.suspended = false;

    logger.info(
      { upcoming: upcoming.length, live: live.length, finished: finished.length, total: allGames.length },
      "International Basketball fixtures refreshed",
    );

    return { upcoming: basketballCache.upcoming, live: basketballCache.live, finished: basketballCache.finished, suspended: false };
  })();
  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  if (!canForce && basketballCache.fetchedAt > 0) {
    return { upcoming: basketballCache.upcoming, live: basketballCache.live, finished: basketballCache.finished, suspended: basketballCache.suspended };
  }

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Single game lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchBasketballGameById(basketballEventId: string): Promise<SportEvent | null> {
  const gameId = basketballEventId.replace(/^basketball_/, "");
  try {
    const data = await basketballFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, basketballEventId }, "Basketball API game lookup failed");
    return null;
  }
}
