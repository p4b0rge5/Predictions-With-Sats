/**
 * MLB data — powered by api-sports.io Baseball API
 *
 * Base URL: https://v1.baseball.api-sports.io
 * Same API key as Football/Basketball/American Football APIs (x-apisports-key header).
 *
 * MLB has NO draws — extra innings are played until a winner is decided.
 * Event IDs are prefixed with "mlb_" to avoid collisions.
 *
 * Free plan: 100 req/day (separate quota from other api-sports.io APIs).
 * Request budget: today + tomorrow + yesterday = 3 req per refresh (1h TTL → ~72/day).
 *
 * Off-season guard: December–February → no regular-season games scheduled.
 * MLB season: Opening Day (late March/April) through World Series (October/November).
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import type { SportEvent } from "./sports";
import { getSportsDateWindowStrings } from "./sports-date-window";

const API_MLB_BASE = "https://v1.baseball.api-sports.io";
const API_MLB_KEY  = process.env.API_FOOTBALL_KEY ?? "";

const MLB_LEAGUE_ID   = 1; // MLB Regular Season
const MLB_PLAYOFFS_ID = 2; // MLB Playoffs (ALCS/NLCS/World Series)

// ---------------------------------------------------------------------------
// Types — Baseball API response format
// ---------------------------------------------------------------------------

interface BaseballGame {
  id: number;
  date: string;         // "2026-04-08T18:40:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  week: string | null;
  season: number;       // 2026
  status: {
    long:  string;      // "Game Finished", "Not Started", etc.
    short: string;      // "FT", "NS", "LIVE", "POST", "CANC", etc.
    timer: string | null;
  };
  league: {
    id:     number;
    name:   string;
    season: number;
    logo:   string;
    country: { name: string; code: string; flag: string };
  };
  country: { name: string; code: string; flag: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  scores: {
    home: { hits: number | null; errors: number | null; innings: Record<string, number | null>; total: number | null };
    away: { hits: number | null; errors: number | null; innings: Record<string, number | null>; total: number | null };
  };
}

interface BaseballApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: BaseballGame[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

// Statuses considered "finished" by Baseball API
const FINISHED_STATUSES = new Set(["FT", "FT OT", "AOT", "WO"]);
// Not-yet-started or cancelled (treat as upcoming/unavailable)
const NOT_STARTED_STATUSES = new Set(["NS", "POST", "CANC", "ABD", "SUSP", "AWD", "WO"]);

function parseMlbStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED_STATUSES.has(s)) return "finished";
  if (NOT_STARTED_STATUSES.has(s)) return "upcoming";
  // Any inning-in-progress status (e.g. "IN1".."IN9", "LIVE", inning codes) → live
  return "live";
}

function parseMlbOutcome(
  homeTotal: number | null,
  awayTotal: number | null,
): SportEvent["outcome"] {
  if (homeTotal === null || awayTotal === null) return null;
  if (homeTotal > awayTotal) return "home";
  if (awayTotal > homeTotal) return "away";
  return null; // MLB always plays extra innings to decide — safety fallback
}

function mapGame(g: BaseballGame): SportEvent {
  const homeScore = g.scores.home.total;
  const awayScore = g.scores.away.total;
  const status    = parseMlbStatus(g.status.short);
  const leagueName = g.league.id === MLB_PLAYOFFS_ID ? "MLB Playoffs" : "MLB";
  return {
    id:         `mlb_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    league:     leagueName,
    sport:      "Baseball",
    country:    "USA",
    startsAt:   g.date,
    status,
    homeScore,
    awayScore,
    outcome:    status === "finished" ? parseMlbOutcome(homeScore, awayScore) : null,
    elapsed:    null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function mlbFetch(path: string): Promise<BaseballApiResponse> {
  if (!API_MLB_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping Baseball API request");
    return { errors: [], results: 0, response: [] };
  }
  const budget = await reserveSportsRequests("mlb", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "mlb", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return {
      errors: { budget: "Daily request budget exhausted" },
      results: 0,
      response: [],
    };
  }
  const url = `${API_MLB_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_MLB_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Baseball API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<BaseballApiResponse>;
}

function hasErrors(errors: BaseballApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Off-season guard: December (11) – February (1)
// MLB Opening Day is usually late March; season ends in November at latest.
// ---------------------------------------------------------------------------

function isMlbOffseason(): boolean {
  const month = new Date().getMonth(); // 0=Jan … 11=Dec
  return month === 11 || month <= 1;   // Dec, Jan, Feb
}

// Current MLB season year: Jan–Nov → current year – 1 if before Opening Day?
// Actually MLB season is identified by the year it starts.
// April 2026 → season 2026; November 2025 → season 2025.
function currentMlbSeason(): number {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();
  // If we're in January/February, the current active season was last year's
  return (month <= 1) ? year - 1 : year;
}

// ---------------------------------------------------------------------------
// Cache (1h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS             = 60 * 60 * 1000;    // 1 hour
const CACHE_ERROR_TTL_MS       = 15 * 60 * 1000;
const MAX_GAME_AGE_MS          = 5 * 60 * 60 * 1000; // MLB games can run 4-5h with extras
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const mlbCache: {
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
  if (kickoff <= now && kickoff > now - MAX_GAME_AGE_MS) {
    return "live";
  }
  return ev.status;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getMlbEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  if (isMlbOffseason()) {
    return { upcoming: [], live: [], finished: [], suspended: false };
  }

  const cacheAge = Date.now() - mlbCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  mlbCache.upcoming,
      live:      mlbCache.live,
      finished:  mlbCache.finished,
      suspended: mlbCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "MLB cache force-refreshed for settlement");
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const season    = currentMlbSeason();

    const MLB_LEAGUE_IDS = [MLB_LEAGUE_ID, MLB_PLAYOFFS_ID];
    const dateWindow = getSportsDateWindowStrings();
    const dateFetches = await Promise.allSettled(
      dateWindow.map((date) => mlbFetch(`/games?date=${date}&league=${MLB_LEAGUE_ID}&season=${season}`)),
    );

    const allGames: BaseballGame[] = [];
    let apiErrored = false;

    for (const result of dateFetches) {
      if (result.status === "fulfilled") {
        if (hasErrors(result.value.errors)) {
          logger.warn({ errors: result.value.errors }, "Baseball API returned errors");
          apiErrored = true;
        }
        const mlbGames = (result.value.response ?? []).filter(
          (g) => typeof g.league?.id === "number" && MLB_LEAGUE_IDS.includes(g.league.id),
        );
        allGames.push(...mlbGames);
      } else {
        logger.warn({ err: result.reason }, "Baseball API date fetch failed");
        apiErrored = true;
      }
    }

    if (apiErrored && allGames.length === 0) {
      mlbCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
      mlbCache.suspended = true;
      logger.warn("Baseball API error — serving stale cache, retrying in 15 min");
      return { upcoming: mlbCache.upcoming, live: mlbCache.live, finished: mlbCache.finished, suspended: true };
    }

    const now    = Date.now();
    const mapped = allGames
      .map(mapGame)
      .map((ev) => ({ ...ev, status: normalizeEventStatus(ev, now) }));

    const upcoming = mapped
      .filter((ev) => {
        if (ev.status !== "upcoming") return false;
        const kickoff = new Date(ev.startsAt).getTime();
        return kickoff > now;
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const live = mapped
      .filter((ev) => ev.status === "live")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

    const finished = mapped
      .filter((ev) => ev.status === "finished")
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 20);

    mlbCache.upcoming  = upcoming;
    mlbCache.live      = live;
    mlbCache.finished  = finished;
    mlbCache.fetchedAt = Date.now();
    mlbCache.suspended = false;

    logger.info(
      { upcoming: upcoming.length, live: live.length, finished: finished.length, total: allGames.length, season },
      "MLB fixtures refreshed",
    );

    return { upcoming: mlbCache.upcoming, live: mlbCache.live, finished: mlbCache.finished, suspended: false };
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Single game lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchMlbGameById(mlbEventId: string): Promise<SportEvent | null> {
  const gameId = mlbEventId.replace(/^mlb_/, "");
  try {
    const data = await mlbFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, mlbEventId }, "Baseball API game lookup failed");
    return null;
  }
}
