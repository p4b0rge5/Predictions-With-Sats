/**
 * Rugby data — powered by api-sports.io Rugby API
 *
 * Base URL: https://v1.rugby.api-sports.io
 * Same API key as other api-sports.io APIs (x-apisports-key header).
 *
 * Rugby DOES have draws in regular season (match ends tied at full time).
 * In knockout stages extra time + sudden death is played, but we still allow
 * DRAW as a betting option — if the result field says "draw" we honour it.
 * Event IDs are prefixed with "rugby_" to avoid collision with other sport IDs.
 *
 * Free plan: 100 req/day (separate quota from other api-sports.io APIs).
 * Request budget: today + tomorrow + yesterday = 3 req per refresh (1h TTL → ~72/day).
 *
 * No single off-season: Rugby runs year-round across both hemispheres
 * (Six Nations Jan–Mar, Super Rugby Feb–Jun, Rugby Championship Jul–Oct, etc.).
 *
 * Settlement duration: 150 min (80 min play + stoppages + halftime + potential extra time).
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import type { SportEvent } from "./sports";
import { getSportsDateWindowStrings } from "./sports-date-window";

const API_RUGBY_BASE = "https://v1.rugby.api-sports.io";
const API_RUGBY_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// ---------------------------------------------------------------------------
// Types — Rugby API response format
// ---------------------------------------------------------------------------

interface RugbyGame {
  id: number;
  date: string;        // "2026-02-01T15:15:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  week: string | null;
  season: number;
  status: {
    short:  string;    // "NS","FT","FT OT","HT","Q1"–"Q4","OT","LIVE","POST","CANC","SUSP","AWD","ABD"
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
  country?: { name: string; code: string; flag: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  scores: {
    home: number | null;
    away: number | null;
  };
}

interface RugbyApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: RugbyGame[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

const FINISHED_STATUSES    = new Set(["FT", "FT OT", "AOT", "AW", "WO", "AWD"]);
const NOT_STARTED_STATUSES = new Set(["NS", "POST", "CANC", "SUSP", "ABD"]);

function parseRugbyStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED_STATUSES.has(s)) return "finished";
  if (NOT_STARTED_STATUSES.has(s)) return "upcoming";
  return "live";
}

function parseRugbyOutcome(
  home: number | null,
  away: number | null,
): SportEvent["outcome"] {
  if (home === null || away === null) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function mapGame(g: RugbyGame): SportEvent {
  const status = parseRugbyStatus(g.status.short);
  const h      = g.scores.home;
  const a      = g.scores.away;
  return {
    id:         `rugby_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    league:     g.league.name ?? "Rugby",
    sport:      "Rugby",
    country:    g.country?.name ?? g.league.country?.name ?? "International",
    startsAt:   g.date,
    status,
    homeScore:  h,
    awayScore:  a,
    outcome:    status === "finished" ? parseRugbyOutcome(h, a) : null,
    elapsed:    typeof g.status.timer === "string" ? parseInt(g.status.timer, 10) || null : null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function rugbyFetch(path: string): Promise<RugbyApiResponse> {
  if (!API_RUGBY_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping Rugby API request");
    return { errors: [], results: 0, response: [] };
  }
  const budget = await reserveSportsRequests("rugby", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "rugby", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return {
      errors: { budget: "Daily request budget exhausted" },
      results: 0,
      response: [],
    };
  }
  const url = `${API_RUGBY_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_RUGBY_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Rugby API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<RugbyApiResponse>;
}

function hasErrors(errors: RugbyApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Cache (1h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS              = 60 * 60 * 1000;    // 1 hour
const CACHE_ERROR_TTL_MS        = 15 * 60 * 1000;
const MAX_GAME_AGE_MS           = 4 * 60 * 60 * 1000; // rugby can run ~3h with extra time
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const rugbyCache: {
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

export async function getRugbyEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - rugbyCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  rugbyCache.upcoming,
      live:      rugbyCache.live,
      finished:  rugbyCache.finished,
      suspended: rugbyCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "Rugby cache force-refreshed for settlement");
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const dateWindow = getSportsDateWindowStrings();
    const dateFetches = await Promise.allSettled(
      dateWindow.map((date) => rugbyFetch(`/games?date=${date}`)),
    );

    const allGames: RugbyGame[] = [];
    let apiErrored = false;

    for (const result of dateFetches) {
      if (result.status === "fulfilled") {
        if (hasErrors(result.value.errors)) {
          logger.warn({ errors: result.value.errors }, "Rugby API returned errors");
          apiErrored = true;
        }
        allGames.push(...(result.value.response ?? []));
      } else {
        logger.warn({ err: result.reason }, "Rugby API date fetch failed");
        apiErrored = true;
      }
    }

    if (apiErrored && allGames.length === 0) {
      rugbyCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
      rugbyCache.suspended = true;
      logger.warn("Rugby API error — serving stale cache, retrying in 15 min");
      return { upcoming: rugbyCache.upcoming, live: rugbyCache.live, finished: rugbyCache.finished, suspended: true };
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

    rugbyCache.upcoming  = upcoming;
    rugbyCache.live      = live;
    rugbyCache.finished  = finished;
    rugbyCache.fetchedAt = Date.now();
    rugbyCache.suspended = false;

    logger.info(
      { upcoming: upcoming.length, live: live.length, finished: finished.length, total: allGames.length },
      "Rugby fixtures refreshed",
    );

    return { upcoming: rugbyCache.upcoming, live: rugbyCache.live, finished: rugbyCache.finished, suspended: false };
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

export async function fetchRugbyGameById(rugbyEventId: string): Promise<SportEvent | null> {
  const gameId = rugbyEventId.replace(/^rugby_/, "");
  try {
    const data = await rugbyFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, rugbyEventId }, "Rugby API game lookup failed");
    return null;
  }
}
