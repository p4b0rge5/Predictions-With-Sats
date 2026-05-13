/**
 * Sports data — powered by ESPN API (primary, no key) + API-Football (fallback)
 *
 * ESPN API (free, no auth, no rate limits):
 *  - Single call returns ALL soccer leagues + NBA/NFL/NHL/MLB/etc.
 *  - Response: ~50KB gzipped with scores, status, team badges, form, odds
 *  - Covers: Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
 *    Primeira Liga, Brasileirão, MLS, Europa League
 *  - Does NOT cover: Champions League (400 off-season), Championship, Liga MX
 *
 * API-Football (100 req/day free plan):
 *  - Fallback for leagues ESPN doesn't cover (Champions League, etc.)
 *  - Date-based queries (?date=YYYY-MM-DD)
 *  - Fixture lookup by ID for settlement
 *
 * Request budget (API-Football only):
 *  - Fetch today + tomorrow: 2 req per cache refresh (1h TTL → ~48/day)
 *  - Settlement lookup: 1 req per open market per check (~<30/day)
 */

import { logger } from "./logger";
import { reserveSportsRequests } from "./sports-request-budget";
import { getSportsDateWindowStrings } from "./sports-date-window";
import { getEspnSoccerEvents, fetchEspnSoccerMatch } from "./espn-soccer";

const API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
const API_FOOTBALL_KEY  = process.env.API_FOOTBALL_KEY ?? "";

// ---------------------------------------------------------------------------
// League IDs (API-Football format — different from TheSportsDB)
// ---------------------------------------------------------------------------

// Curated for highest global betting volume.
// Keep these groups separate so expansion waves can be reverted quickly if they
// cause noise, too many open markets, or settlement instability.
const CORE_LEAGUE_IDS: readonly number[] = [
  // European elite (Tier 1 — top global volume)
  2,   // UEFA Champions League
  3,   // UEFA Europa League
  39,  // Premier League (England)
  140, // La Liga (Spain)
  78,  // Bundesliga (Germany)
  135, // Serie A (Italy)
  61,  // Ligue 1 (France)
  // Americas / regional anchors
  13,  // Copa Libertadores (South America)
  71,  // Brasileirao Serie A (Brazil)
  292, // K League 1 (South Korea)
];

const FIRST_WAVE_LEAGUE_IDS: readonly number[] = [
  848, // UEFA Europa Conference League
  40,  // Championship (England)
  94,  // Primeira Liga (Portugal)
  253, // Major League Soccer (USA)
  262, // Liga MX (Mexico)
];

const SECOND_WAVE_LEAGUE_IDS: readonly number[] = [
  128, // Liga Profesional Argentina
  88,  // Eredivisie (Netherlands)
  203, // Super Lig (Turkey)
  144, // Jupiler Pro League (Belgium)
  307, // Saudi Pro League
];

const LEAGUE_IDS = new Set([
  ...CORE_LEAGUE_IDS,
  ...FIRST_WAVE_LEAGUE_IDS,
  ...SECOND_WAVE_LEAGUE_IDS,
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
  leagueId?: number | null;
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
    leagueId:  f.league.id,
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
  const budget = await reserveSportsRequests("football", 1);
  if (!budget.allowed) {
    logger.warn(
      { provider: "football", path, used: budget.used, remaining: budget.remaining },
      "Sports provider daily request budget exhausted",
    );
    return {
      errors: { budget: "Daily request budget exhausted" },
      results: 0,
      response: [],
    };
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

function normalizeEventStatus(ev: SportEvent, now: number): SportEvent["status"] {
  if (ev.status !== "upcoming") return ev.status;
  const kickoff = new Date(ev.startsAt).getTime();
  if (kickoff <= now && kickoff > now - MAX_MATCH_DURATION_MS) {
    return "live";
  }
  return ev.status;
}

const cache: {
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  fetchedAt: number;
  suspended: boolean;
} = { upcoming: [], live: [], finished: [], fetchedAt: 0, suspended: false };
let refreshPromise: Promise<{ upcoming: SportEvent[]; live: SportEvent[]; finished: SportEvent[]; suspended: boolean }> | null = null;

function hasApiErrors(errors: ApiResponse["errors"]): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Object.keys(errors ?? {}).length > 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Minimum gap between force-refreshes to protect the daily API budget
const FORCE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export async function getSportsEvents(forceRefresh = false): Promise<{
  upcoming:  SportEvent[];
  live:      SportEvent[];
  finished:  SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - cache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS;
  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return { upcoming: cache.upcoming, live: cache.live, finished: cache.finished, suspended: cache.suspended };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "Sports cache force-refreshed for settlement");
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    // Primary: ESPN (free, no key, covers 8 major leagues in one call)
    let espnResults = { upcoming: [] as SportEvent[], live: [] as SportEvent[], finished: [] as SportEvent[], suspended: false };
    try {
      espnResults = await getEspnSoccerEvents(forceRefresh);
    } catch (err) {
      logger.warn({ err }, "ESPN soccer fetch failed, relying on API-Football fallback");
    }

    // Fallback: API-Football for leagues ESPN doesn't cover
    let afResults = { upcoming: [] as SportEvent[], live: [] as SportEvent[], finished: [] as SportEvent[] };
    const hasApiKey = !!API_FOOTBALL_KEY;

    if (hasApiKey) {
      try {
        const dateWindow = getSportsDateWindowStrings();
        const dateFetches = await Promise.allSettled(
          dateWindow.map((date) => apiFetch(`/fixtures?date=${date}`)),
        );

        const allFixtures: ApiFixture[] = [];
        let apiErrored = false;

        for (const result of dateFetches) {
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

        if (!apiErrored || allFixtures.length > 0) {
          const filtered = allFixtures.filter((f) => LEAGUE_IDS.has(f.league.id));
          const now      = Date.now();
          const mapped   = filtered
            .map(mapFixture)
            .map((ev) => ({ ...ev, status: normalizeEventStatus(ev, now) }));

          afResults = {
            upcoming: mapped
              .filter((ev) => ev.status === "upcoming" && new Date(ev.startsAt).getTime() > now)
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
            live: mapped
              .filter((ev) => ev.status === "live")
              .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
            finished: mapped
              .filter((ev) => ev.status === "finished")
              .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
              .slice(0, 30),
          };
        }
      } catch (err) {
        logger.warn({ err }, "API-Football fetch failed");
      }
    }

    // Merge: ESPN events (prefix espn_) + API-Football events (numeric ids)
    // Deduplicate by id (they use different ID formats so no collision)
    const now = Date.now();

    const combinedUpcoming = [...espnResults.upcoming, ...afResults.upcoming]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const combinedLive     = [...espnResults.live,     ...afResults.live];
    const combinedFinished = [...espnResults.finished, ...afResults.finished]
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, 40);

    const suspended = espnResults.suspended && (!hasApiKey || afResults.upcoming.length === 0);

    cache.upcoming  = combinedUpcoming;
    cache.live      = combinedLive;
    cache.finished  = combinedFinished;
    cache.fetchedAt = now;
    cache.suspended = suspended;

    const espnCount = espnResults.upcoming.length + espnResults.live.length + espnResults.finished.length;
    const afCount   = afResults.upcoming.length + afResults.live.length + afResults.finished.length;
    logger.info(
      {
        upcoming: combinedUpcoming.length,
        live: combinedLive.length,
        finished: combinedFinished.length,
        espn: espnCount,
        apiFootball: afCount,
      },
      "Soccer fixtures refreshed (ESPN + API-Football)",
    );

    return { upcoming: cache.upcoming, live: cache.live, finished: cache.finished, suspended: cache.suspended };
  })();
  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  if (!canForce && cache.fetchedAt > 0) {
    return { upcoming: cache.upcoming, live: cache.live, finished: cache.finished, suspended: cache.suspended };
  }

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Single fixture lookup (used by settlement poller)
// ---------------------------------------------------------------------------

export async function fetchFixtureById(fixtureId: string): Promise<SportEvent | null> {
  // If this is an ESPN event ID, use ESPN lookup directly
  if (fixtureId.startsWith("espn_")) {
    try {
      return await fetchEspnSoccerMatch(fixtureId);
    } catch {
      return null;
    }
  }
  // Otherwise use API-Football
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
