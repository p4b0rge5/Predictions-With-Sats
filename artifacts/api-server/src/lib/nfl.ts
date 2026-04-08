/**
 * NFL data — powered by api-sports.io American Football API
 *
 * Base URL: https://v1.american-football.api-sports.io
 * Same API key as API-Football (x-apisports-key header).
 *
 * NFL has NO draws — overtime is played until a winner is decided.
 * Event IDs are prefixed with "nfl_" to avoid collision with other sport IDs.
 *
 * Free plan: 100 req/day (separate quota from Football & Basketball APIs).
 * Request budget: today + tomorrow + yesterday = 3 req per refresh (3h TTL → ~24/day).
 *
 * Off-season guard: April–July we skip all API calls (no games scheduled).
 */

import { logger } from "./logger";
import type { SportEvent } from "./sports";

const API_NFL_BASE = "https://v1.american-football.api-sports.io";
const API_NFL_KEY  = process.env.API_FOOTBALL_KEY ?? "";

const NFL_LEAGUE_ID    = 1; // NFL Regular Season
const NFL_PLAYOFFS_ID  = 2; // NFL Playoffs / Super Bowl

// ---------------------------------------------------------------------------
// Types — American Football API response format
// ---------------------------------------------------------------------------

interface NflGame {
  id: number;
  date: string;          // "2025-09-07T18:00:00+00:00"
  time: string;
  timestamp: number;
  timezone: string;
  week: string;
  season: number;        // 2025
  stage: string;         // "Regular Season"
  status: {
    short: string;       // "NS","Q1","Q2","Q3","Q4","HT","OT","FT","FT OT","POST","CANC"
    long: string;
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
    home: { quarter_1: number | null; quarter_2: number | null; quarter_3: number | null; quarter_4: number | null; overtime: number | null; total: number | null };
    away: { quarter_1: number | null; quarter_2: number | null; quarter_3: number | null; quarter_4: number | null; overtime: number | null; total: number | null };
  };
}

interface NflApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: NflGame[];
}

// ---------------------------------------------------------------------------
// Status & outcome helpers
// ---------------------------------------------------------------------------

function parseNflStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (["FT", "FT OT", "AOT"].includes(s)) return "finished";
  if (["Q1", "Q2", "Q3", "Q4", "HT", "OT", "BT"].includes(s)) return "live";
  return "upcoming"; // "NS", "POST", "CANC", etc.
}

function parseNflOutcome(
  homeTotal: number | null,
  awayTotal: number | null,
): SportEvent["outcome"] {
  if (homeTotal === null || awayTotal === null) return null;
  if (homeTotal > awayTotal) return "home";
  if (awayTotal > homeTotal) return "away";
  return null; // NFL always plays OT to decide — safety fallback
}

function mapGame(g: NflGame): SportEvent {
  const homeScore  = g.scores.home.total;
  const awayScore  = g.scores.away.total;
  const status     = parseNflStatus(g.status.short);
  const leagueName = g.league.id === NFL_PLAYOFFS_ID ? "NFL Playoffs" : "NFL";
  return {
    id:         `nfl_${g.id}`,
    event:      `${g.teams.home.name} vs ${g.teams.away.name}`,
    homeTeam:   g.teams.home.name,
    awayTeam:   g.teams.away.name,
    homeBadge:  g.teams.home.logo || null,
    awayBadge:  g.teams.away.logo || null,
    leagueLogo: g.league.logo || null,
    league:     leagueName,
    sport:      "American Football",
    country:    "USA",
    startsAt:   g.date,
    status,
    homeScore,
    awayScore,
    outcome:    status === "finished" ? parseNflOutcome(homeScore, awayScore) : null,
    elapsed:    null,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function nflFetch(path: string): Promise<NflApiResponse> {
  if (!API_NFL_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping American Football API request");
    return { errors: [], results: 0, response: [] };
  }
  const url = `${API_NFL_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_NFL_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`American Football API HTTP ${res.status} for ${path}`);
  return res.json() as Promise<NflApiResponse>;
}

function hasErrors(errors: NflApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Off-season guard: April (month 3) – July (month 6), zero-indexed
// No regular-season or playoff games are scheduled in this window.
// ---------------------------------------------------------------------------

function isNflOffseason(): boolean {
  const month = new Date().getMonth(); // 0=Jan … 11=Dec
  return month >= 3 && month <= 6;    // Apr, May, Jun, Jul
}

// Current NFL season year: Sep–Dec → current year; Jan–Mar → current year – 1
function currentNflSeason(): number {
  const now   = new Date();
  const month = now.getMonth(); // 0-indexed
  const year  = now.getFullYear();
  return month >= 8 ? year : year - 1; // August (8) or later → current year season
}

// ---------------------------------------------------------------------------
// Cache (3h TTL on success, 15-min retry on error)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS             = 3 * 60 * 60 * 1000;   // 3 hours (games are weekly)
const CACHE_ERROR_TTL_MS       = 15 * 60 * 1000;
const MAX_GAME_AGE_MS          = 5 * 60 * 60 * 1000;   // NFL games can run ~4h with OT
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

const nflCache: {
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], finished: [], fetchedAt: 0, suspended: false };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getNflEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  // During off-season, return empty results without making any API calls
  if (isNflOffseason()) {
    return { upcoming: [], finished: [], suspended: false };
  }

  const cacheAge = Date.now() - nflCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return {
      upcoming:  nflCache.upcoming,
      finished:  nflCache.finished,
      suspended: nflCache.suspended,
    };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "NFL cache force-refreshed for settlement");
  }

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const today     = toDateStr(new Date());
  const tomorrow  = toDateStr(new Date(Date.now() + 86_400_000));
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  const season    = currentNflSeason();

  const NFL_LEAGUE_IDS = [NFL_LEAGUE_ID, NFL_PLAYOFFS_ID];

  const [todayData, tomorrowData, yesterdayData] = await Promise.allSettled([
    nflFetch(`/games?date=${today}&league=${NFL_LEAGUE_ID}&season=${season}`),
    nflFetch(`/games?date=${tomorrow}&league=${NFL_LEAGUE_ID}&season=${season}`),
    nflFetch(`/games?date=${yesterday}&league=${NFL_LEAGUE_ID}&season=${season}`),
  ]);

  const allGames: NflGame[] = [];
  let apiErrored = false;

  for (const result of [todayData, tomorrowData, yesterdayData]) {
    if (result.status === "fulfilled") {
      if (hasErrors(result.value.errors)) {
        logger.warn({ errors: result.value.errors }, "American Football API returned errors");
        apiErrored = true;
      }
      const nflGames = (result.value.response ?? []).filter(
        (g) => NFL_LEAGUE_IDS.includes(g.league.id),
      );
      allGames.push(...nflGames);
    } else {
      logger.warn({ err: result.reason }, "American Football API date fetch failed");
      apiErrored = true;
    }
  }

  if (apiErrored && allGames.length === 0) {
    nflCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
    nflCache.suspended = true;
    logger.warn("American Football API error — serving stale cache, retrying in 15 min");
    return { upcoming: nflCache.upcoming, finished: nflCache.finished, suspended: true };
  }

  const mapped = allGames.map(mapGame);
  const now    = Date.now();

  const upcoming = mapped
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      const kickoff = new Date(ev.startsAt).getTime();
      return kickoff > now - MAX_GAME_AGE_MS;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const finished = mapped
    .filter((ev) => ev.status === "finished")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 20);

  nflCache.upcoming  = upcoming;
  nflCache.finished  = finished;
  nflCache.fetchedAt = Date.now();
  nflCache.suspended = false;

  logger.info(
    { upcoming: upcoming.length, finished: finished.length, total: allGames.length, season },
    "NFL fixtures refreshed",
  );

  return { upcoming: nflCache.upcoming, finished: nflCache.finished, suspended: false };
}

// ---------------------------------------------------------------------------
// Single game lookup (used by settlement poller when cache is stale)
// ---------------------------------------------------------------------------

export async function fetchNflGameById(nflEventId: string): Promise<SportEvent | null> {
  const gameId = nflEventId.replace(/^nfl_/, "");
  try {
    const data = await nflFetch(`/games?id=${gameId}`);
    const g = data.response?.[0];
    if (!g) return null;
    return mapGame(g);
  } catch (err) {
    logger.warn({ err, nflEventId }, "American Football API game lookup failed");
    return null;
  }
}
