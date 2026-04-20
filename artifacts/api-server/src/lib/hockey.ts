/**
 * Hockey data — powered by api-sports.io Hockey API
 *
 * Base URL: https://v1.hockey.api-sports.io
 * Same API key as other api-sports.io APIs (x-apisports-key header).
 *
 * All leagues returned by the API are accepted (NHL, AHL, ECHL, European leagues, etc.).
 * Users filter by league in the UI. Event IDs are prefixed with "hockey_".
 *
 * Free plan: 100 req/day (separate quota from other api-sports.io APIs), allows only yesterday
 * + today + tomorrow.
 * Request budget: 3-day window → 3 req per refresh (3h TTL → 8 refreshes/day → ~24 req/day).
 *
 * Game duration: ~2.5h regular, up to ~3.5h with OT/shootout.
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import type { SportEvent } from "./sports";

// Free plan only allows yesterday + today + tomorrow (3 days).
// Using 8 days wastes quota and causes plan errors for 5 of the 8 dates.
function getHockeyDateWindowStrings(nowMs = Date.now()): string[] {
  const base = new Date(nowMs);
  base.setUTCHours(0, 0, 0, 0);
  return [-1, 0, 1].map((offset) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  });
}

const API_HOCKEY_BASE = "https://v1.hockey.api-sports.io";
const API_HOCKEY_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// ---------------------------------------------------------------------------
// Types — Hockey API response format
// ---------------------------------------------------------------------------

interface HockeyGame {
  id: number;
  date: string;      // "2026-04-18T19:00:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  status: {
    long:  string;
    short: string;   // "NS","P1","P2","P3","OT","SO","BT","FT","AOT","APS","POST","CANC","SUSP"
    timer: string | null;
  };
  league: {
    id:     number;
    name:   string;
    type:   string;
    season: string;
    logo:   string;
  };
  country: { id: number; name: string; code: string; flag: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  scores: {
    home: { period_1: number | null; period_2: number | null; period_3: number | null; overtime: number | null; total: number | null } | null;
    away: { period_1: number | null; period_2: number | null; period_3: number | null; overtime: number | null; total: number | null } | null;
  };
}

interface HockeyApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: HockeyGame[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

const FINISHED_STATUSES = new Set(["FT", "AOT", "APS"]);
const LIVE_STATUSES     = new Set(["P1", "P2", "P3", "OT", "SO", "BT"]);

function parseHockeyStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (FINISHED_STATUSES.has(s)) return "finished";
  if (LIVE_STATUSES.has(s))     return "live";
  return "upcoming"; // "NS", "POST", "CANC", "SUSP", etc.
}

function parseHockeyOutcome(homeTotal: number | null, awayTotal: number | null): SportEvent["outcome"] {
  if (homeTotal === null || awayTotal === null) return null;
  if (homeTotal > awayTotal) return "home";
  if (awayTotal > homeTotal) return "away";
  return null; // NHL always resolves via OT/SO — safety fallback
}

function mapGame(g: HockeyGame): SportEvent {
  const homeScore  = g.scores.home?.total ?? null;
  const awayScore  = g.scores.away?.total ?? null;
  const status     = parseHockeyStatus(g.status.short);
  const leagueName = g.league.name;
  return {
    id:         `hockey_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    league:     leagueName,
    sport:      "Hockey",
    country:    g.country?.name ?? "USA",
    startsAt:   g.date,
    status,
    homeScore,
    awayScore,
    outcome:    status === "finished" ? parseHockeyOutcome(homeScore, awayScore) : null,
    elapsed:    null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function hockeyFetch(path: string): Promise<HockeyApiResponse> {
  if (!API_HOCKEY_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping Hockey API request");
    return { errors: [], results: 0, response: [] };
  }
  const budget = await reserveSportsRequests("hockey", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "hockey", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return { errors: { budget: "Daily request budget exhausted" }, results: 0, response: [] };
  }
  const url = `${API_HOCKEY_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_HOCKEY_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hockey API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<HockeyApiResponse>;
}

function hasErrors(errors: HockeyApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Cache (3h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS              = 3 * 60 * 60 * 1000; // 3 hours — keeps daily requests at ~64 (under 100/day budget)
const CACHE_ERROR_TTL_MS        = 15 * 60 * 1000;
const MAX_GAME_AGE_MS           = 4 * 60 * 60 * 1000; // up to 3.5h with OT/SO + buffer
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

function normalizeEventStatus(ev: SportEvent, now: number): SportEvent["status"] {
  if (ev.status !== "upcoming") return ev.status;
  const kickoff = new Date(ev.startsAt).getTime();
  if (kickoff <= now && kickoff > now - MAX_GAME_AGE_MS) return "live";
  return ev.status;
}

const hockeyCache: {
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

export async function getHockeyEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - hockeyCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  hockeyCache.upcoming,
      live:      hockeyCache.live,
      finished:  hockeyCache.finished,
      suspended: hockeyCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "Hockey cache force-refreshed for settlement");
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const dateWindow = getHockeyDateWindowStrings();
    const dateFetches = await Promise.allSettled(
      dateWindow.map((date) => hockeyFetch(`/games?date=${date}`)),
    );

    const allGames: HockeyGame[] = [];
    let apiErrored = false;

    for (const result of dateFetches) {
      if (result.status === "fulfilled") {
        if (hasErrors(result.value.errors)) {
          logger.warn({ errors: result.value.errors }, "Hockey API returned errors");
          apiErrored = true;
        }
        allGames.push(...(result.value.response ?? []));
      } else {
        logger.warn({ err: result.reason }, "Hockey API date fetch failed");
        apiErrored = true;
      }
    }

    if (apiErrored && allGames.length === 0) {
      hockeyCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
      const hasStale = hockeyCache.upcoming.length > 0 || hockeyCache.live.length > 0 || hockeyCache.finished.length > 0;
      hockeyCache.suspended = !hasStale;
      logger.warn({ hasStale }, hasStale
        ? "Hockey API error — serving stale cache without suspension"
        : "Hockey API error — no stale data available, suspending");
      return { upcoming: hockeyCache.upcoming, live: hockeyCache.live, finished: hockeyCache.finished, suspended: hockeyCache.suspended };
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

    hockeyCache.upcoming  = upcoming;
    hockeyCache.live      = live;
    hockeyCache.finished  = finished;
    hockeyCache.fetchedAt = Date.now();
    hockeyCache.suspended = false;

    logger.info(
      { upcoming: upcoming.length, live: live.length, finished: finished.length, total: allGames.length },
      "Hockey fixtures refreshed",
    );

    return { upcoming: hockeyCache.upcoming, live: hockeyCache.live, finished: hockeyCache.finished, suspended: false };
  })();
  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  if (!canForce && hockeyCache.fetchedAt > 0) {
    return { upcoming: hockeyCache.upcoming, live: hockeyCache.live, finished: hockeyCache.finished, suspended: hockeyCache.suspended };
  }

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Single game lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchHockeyGameById(hockeyEventId: string): Promise<SportEvent | null> {
  const gameId = hockeyEventId.replace(/^hockey_/, "");
  try {
    const data = await hockeyFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, hockeyEventId }, "Hockey API game lookup failed");
    return null;
  }
}
