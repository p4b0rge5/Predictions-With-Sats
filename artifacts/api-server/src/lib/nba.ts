/**
 * NBA data — powered by api-sports.io Basketball API
 *
 * Base URL: https://v1.basketball.api-sports.io
 * Same API key as API-Football (x-apisports-key header).
 *
 * NBA has NO draws — outcomes are always "home" or "away" (OT decides ties).
 * Event IDs are prefixed with "nba_" to avoid collision with football IDs.
 *
 * Free plan: 100 req/day per API.
 * Request budget: today + tomorrow + yesterday = 3 req per cache refresh (1h TTL → ~72/day).
 */

import { logger } from "./logger";
import type { SportEvent } from "./sports";

const API_NBA_BASE = "https://v1.basketball.api-sports.io";
const API_NBA_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// NBA league IDs in the Basketball API
const NBA_LEAGUE_ID    = 12; // NBA Regular Season
const NBA_PLAYOFFS_ID  = 13; // NBA Playoffs

// ---------------------------------------------------------------------------
// Types — Basketball API response format (similar to Football API)
// ---------------------------------------------------------------------------

interface BasketballGame {
  id: number;
  date: string;          // ISO date string "2026-04-08T19:30:00+00:00"
  time: string;
  timestamp: number;
  league: {
    id:     number;
    name:   string;
    type:   string;
    season: string;      // "2025-2026"
    logo:   string;
  };
  country: { id: number; name: string; code: string; flag: string };
  status: {
    long:  string;       // "Game Finished", "Not Started", "In Play", etc.
    short: string;       // "FT", "NS", "Q1", "Q2", "Q3", "Q4", "HT", "OT", "POST", "CANC"
    timer: string | null;
  };
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

function parseBasketballStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (["FT", "AOT"].includes(s)) return "finished";
  if (["Q1", "Q2", "Q3", "Q4", "HT", "OT", "BT"].includes(s)) return "live";
  return "upcoming"; // "NS", "POST", "CANC", etc.
}

function parseBasketballOutcome(homeTotal: number | null, awayTotal: number | null): SportEvent["outcome"] {
  if (homeTotal === null || awayTotal === null) return null;
  if (homeTotal > awayTotal) return "home";
  if (awayTotal > homeTotal) return "away";
  return null; // NBA always plays OT to decide — this is a safety fallback
}

function mapGame(g: BasketballGame): SportEvent {
  const homeScore = g.scores.home.total;
  const awayScore = g.scores.away.total;
  const status    = parseBasketballStatus(g.status.short);
  const leagueName = g.league.id === NBA_PLAYOFFS_ID ? "NBA Playoffs" : "NBA";
  return {
    id:         `nba_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    league:     leagueName,
    sport:      "Basketball",
    country:    "USA",
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

async function nbsFetch(path: string): Promise<BasketballApiResponse> {
  if (!API_NBA_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping Basketball API request");
    return { errors: [], results: 0, response: [] };
  }
  const url = `${API_NBA_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_NBA_KEY, Accept: "application/json" },
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
// Cache (1h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS             = 60 * 60 * 1000;
const CACHE_ERROR_TTL_MS       = 15 * 60 * 1000;
const MAX_GAME_AGE_MS          = 4 * 60 * 60 * 1000; // games ~3-3.5h with OT
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;    // 10 minutes between force-refreshes

const nbaCache: {
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], finished: [], fetchedAt: 0, suspended: false };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getNbaEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - nbaCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  nbaCache.upcoming,
      finished:  nbaCache.finished,
      suspended: nbaCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "NBA cache force-refreshed for settlement");
  }

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const today     = toDateStr(new Date());
  const tomorrow  = toDateStr(new Date(Date.now() + 86_400_000));
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));

  const NBA_LEAGUE_IDS = [NBA_LEAGUE_ID, NBA_PLAYOFFS_ID];

  // Fetch each date without league filter, then filter in code.
  // The Basketball API accepts one league ID at a time; fetching all and filtering is simpler.
  const [todayData, tomorrowData, yesterdayData] = await Promise.allSettled([
    nbsFetch(`/games?date=${today}`),
    nbsFetch(`/games?date=${tomorrow}`),
    nbsFetch(`/games?date=${yesterday}`),
  ]);

  const allGames: BasketballGame[] = [];
  let apiErrored = false;

  for (const result of [todayData, tomorrowData, yesterdayData]) {
    if (result.status === "fulfilled") {
      if (hasErrors(result.value.errors)) {
        logger.warn({ errors: result.value.errors }, "Basketball API returned errors");
        apiErrored = true;
      }
      // Filter to NBA regular season and playoffs only
      const nbaGames = (result.value.response ?? []).filter(
        (g) => NBA_LEAGUE_IDS.includes(g.league.id),
      );
      allGames.push(...nbaGames);
    } else {
      logger.warn({ err: result.reason }, "Basketball API date fetch failed");
      apiErrored = true;
    }
  }

  if (apiErrored && allGames.length === 0) {
    nbaCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
    nbaCache.suspended = true;
    logger.warn("Basketball API error — serving stale cache, retrying in 15 min");
    return { upcoming: nbaCache.upcoming, finished: nbaCache.finished, suspended: true };
  }

  const mapped = allGames.map(mapGame);
  const now    = Date.now();

  const upcoming = mapped
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      const tip = new Date(ev.startsAt).getTime();
      return tip > now - MAX_GAME_AGE_MS;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const finished = mapped
    .filter((ev) => ev.status === "finished")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 20);

  nbaCache.upcoming  = upcoming;
  nbaCache.finished  = finished;
  nbaCache.fetchedAt = Date.now();
  nbaCache.suspended = false;

  logger.info(
    { upcoming: upcoming.length, finished: finished.length, total: allGames.length },
    "NBA/Basketball fixtures refreshed",
  );

  return { upcoming: nbaCache.upcoming, finished: nbaCache.finished, suspended: false };
}

// ---------------------------------------------------------------------------
// Single game lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchNbaGameById(nbaEventId: string): Promise<SportEvent | null> {
  // eventId is prefixed with "nba_", strip it to get the numeric game ID
  const gameId = nbaEventId.replace(/^nba_/, "");
  try {
    const data = await nbsFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, nbaEventId }, "Basketball API game lookup failed");
    return null;
  }
}
