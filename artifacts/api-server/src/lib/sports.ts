/**
 * Sports data — powered by API-Football (api-sports.io)
 *
 * Free plan constraints (100 req/day):
 *  - Date-based queries (?date=YYYY-MM-DD) work without season parameter
 *  - Cannot use ?next=N / ?last=N / ?season=2025
 *  - Fixture lookup by ID works for settlement
 *
 * Request budget:
 *  - Fetch today + tomorrow: 2 req per cache refresh (1h TTL → ~48/day)
 *  - Settlement lookup: 1 req per open market per check (~<30/day)
 */

import { logger } from "./logger";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const API_FOOTBALL_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// ---------------------------------------------------------------------------
// League IDs (API-Football format — different from TheSportsDB)
// ---------------------------------------------------------------------------

// Curated for highest global betting volume.
// Removed: UECL (4), Championship (40), Primeira Liga (94), MLS (253), Saudi Pro League (307)
const LEAGUE_IDS = new Set([
  // European elite (Tier 1 — top global volume)
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  39,  // Premier League (England)
  140, // La Liga (Spain)
  78,  // Bundesliga (Germany)
  135, // Serie A (Italy)
  61,  // Ligue 1 (France)
  // Americas (Tier 2 — large regional markets)
  13,  // Copa Libertadores (South America)
  71,  // Brasileirão Série A (Brazil)
  292, // Liga MX (Mexico)
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SportEvent {
  id:        string;
  event:     string;
  homeTeam:  string;
  awayTeam:  string;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league:    string;
  sport:     string;
  country:   string;
  startsAt:  string;
  status:    "upcoming" | "finished" | "live";
  homeScore: number | null;
  awayScore: number | null;
  outcome:   "home" | "away" | "draw" | null;
  elapsed:   number | null;
}

interface ApiFixture {
  fixture: {
    id:     number;
    date:   string;
    status: { short: string; long: string; elapsed: number | null };
    venue:  { name: string | null; city: string | null };
  };
  league: { id: number; name: string; logo: string };
  teams: {
    home: { id: number; name: string; logo: string };
    away: { id: number; name: string; logo: string };
  };
  goals: { home: number | null; away: number | null };
}

interface ApiResponse {
  errors:   Record<string, string> | unknown[];
  results:  number;
  response: ApiFixture[];
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function parseStatus(short: string): SportEvent["status"] {
  const s = (short ?? "").toUpperCase();
  if (["FT", "AET", "PEN"].includes(s)) return "finished";
  if (["1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(s)) return "live";
  return "upcoming";
}

function parseOutcome(home: number | null, away: number | null): SportEvent["outcome"] {
  if (home === null || away === null) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function mapFixture(f: ApiFixture): SportEvent {
  const homeScore = f.goals.home;
  const awayScore = f.goals.away;
  const status    = parseStatus(f.fixture.status.short);
  return {
    id:        String(f.fixture.id),
    event:     `${f.teams.home.name} vs ${f.teams.away.name}`,
    homeTeam:  f.teams.home.name,
    awayTeam:  f.teams.away.name,
    homeBadge: f.teams.home.logo || null,
    awayBadge: f.teams.away.logo || null,
    leagueLogo: f.league.logo || null,
    league:    f.league.name,
    sport:     "Soccer",
    country:   "",
    startsAt:  f.fixture.date,
    status,
    homeScore,
    awayScore,
    outcome:   parseOutcome(homeScore, awayScore),
    elapsed:   f.fixture.status.elapsed,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function apiFetch(path: string): Promise<ApiResponse> {
  if (!API_FOOTBALL_KEY) {
    logger.warn("API_FOOTBALL_KEY not set — skipping API-Football request");
    return { errors: [], results: 0, response: [] };
  }
  const url = `${API_FOOTBALL_BASE}${path}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status} for ${path}`);
  return res.json() as Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Cache (1-hour TTL on success; 15-min retry on API errors)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS       = 60 * 60 * 1000;      // 1 hour — normal
const CACHE_ERROR_TTL_MS = 15 * 60 * 1000;       // 15 min — retry on error
const MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000;

const cache: {
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], finished: [], fetchedAt: 0, suspended: false };

function hasApiErrors(errors: ApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSportsEvents(): Promise<{
  upcoming:  SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { upcoming: cache.upcoming, finished: cache.finished, suspended: cache.suspended };
  }

  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  const today     = toDateStr(new Date());
  const tomorrow  = toDateStr(new Date(Date.now() + 86_400_000));
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));

  const [todayData, tomorrowData, yesterdayData] = await Promise.allSettled([
    apiFetch(`/fixtures?date=${today}`),
    apiFetch(`/fixtures?date=${tomorrow}`),
    apiFetch(`/fixtures?date=${yesterday}`),
  ]);

  const allFixtures: ApiFixture[] = [];
  let apiErrored = false;

  for (const result of [todayData, tomorrowData, yesterdayData]) {
    if (result.status === "fulfilled") {
      const data = result.value;
      if (hasApiErrors(data.errors)) {
        logger.warn({ errors: data.errors }, "API-Football returned errors");
        apiErrored = true;
      }
      allFixtures.push(...(data.response ?? []));
    } else {
      logger.warn({ err: result.reason }, "API-Football date fetch failed");
      apiErrored = true;
    }
  }

  // If API errored and we have no fixtures at all, preserve stale cache data.
  // Only schedule a short retry (15 min) instead of the normal 1-hour TTL.
  if (apiErrored && allFixtures.length === 0) {
    cache.fetchedAt  = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
    cache.suspended  = true;
    logger.warn("API-Football error — serving stale cache, retrying in 15 min");
    return { upcoming: cache.upcoming, finished: cache.finished, suspended: true };
  }

  // Filter to our leagues only
  const filtered = allFixtures.filter((f) => LEAGUE_IDS.has(f.league.id));
  const mapped   = filtered.map(mapFixture);
  const now      = Date.now();

  // Upcoming: not started yet, kickoff within the future (or up to 3h ago as safety)
  const upcoming = mapped
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      const kickoff = new Date(ev.startsAt).getTime();
      return kickoff > now - MAX_MATCH_DURATION_MS;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // Finished: completed matches from today/yesterday
  const finished = mapped
    .filter((ev) => ev.status === "finished")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 30);

  cache.upcoming  = upcoming;
  cache.finished  = finished;
  cache.fetchedAt = Date.now();
  cache.suspended = false;

  logger.info(
    { upcoming: upcoming.length, finished: finished.length, total: filtered.length },
    "API-Football fixtures refreshed",
  );

  return { upcoming: cache.upcoming, finished: cache.finished, suspended: false };
}

// ---------------------------------------------------------------------------
// Single fixture lookup (used by settlement poller)
// ---------------------------------------------------------------------------

export async function fetchFixtureById(fixtureId: string): Promise<SportEvent | null> {
  try {
    const data = await apiFetch(`/fixtures?id=${fixtureId}`);
    const f = data.response?.[0];
    if (!f) return null;
    return mapFixture(f);
  } catch (err) {
    logger.warn({ err, fixtureId }, "API-Football fixture lookup failed");
    return null;
  }
}
