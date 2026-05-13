/**
 * Soccer data — powered by ESPN API (no key required)
 *
 * Two endpoint patterns:
 *   1. GET /apis/v2/scoreboard/header  → ALL sports, ALL leagues (flat events)
 *   2. GET /sports/soccer/{slug}/scoreboard → single league (nested competitions)
 *
 * The header endpoint is used as primary — one call covers everything.
 *
 * Soccer league slugs: eng.1 (PL), esp.1 (La Liga), ita.1 (Serie A),
 * ger.1 (Bundesliga), fra.1 (Ligue 1), por.1 (Primeira Liga),
 * bra.1 (Brasileirão), usa.1 (MLS)
 *
 * No auth, no rate limits. ESPN returns plain JSON (no gzip in practice).
 */

import { logger } from "./logger";
import type { SportEvent } from "./sports";

const ESPN_BASE = "https://site.api.espn.com";

// ---------------------------------------------------------------------------
// League configuration — for label overrides and fallback per-league fetch
// ---------------------------------------------------------------------------

const LEAGUE_CONFIG = new Map([
  ["eng.1",        { name: "Premier League",      priority: 1 }],
  ["esp.1",        { name: "La Liga",             priority: 1 }],
  ["ita.1",        { name: "Serie A",             priority: 1 }],
  ["ita.coppa_italia", { name: "Coppa Italia",    priority: 2 }],
  ["ger.1",        { name: "Bundesliga",          priority: 1 }],
  ["fra.1",        { name: "Ligue 1",             priority: 1 }],
  ["por.1",        { name: "Primeira Liga",       priority: 2 }],
  ["bra.1",        { name: "Brasileirão Série A", priority: 2 }],
  ["usa.1",        { name: "MLS",                 priority: 2 }],
  ["uefa.europa",  { name: "UEFA Europa League",  priority: 1 }],
]);

// ---------------------------------------------------------------------------
// ESPN API response types
// ---------------------------------------------------------------------------

// Header endpoint: events are flat with competitors at event level
interface HeaderEvent {
  id: string;
  date: string;
  name: string;
  shortName?: string;
  status: string;            // "pre" | "in" | "post"
  summary: string;           // "FT" | "HT" etc.
  period: number;
  clock: string;
  location: string;
  competitors: Array<{
    id: string;
    homeAway: "home" | "away";
    winner: boolean;
    score: string;
    form?: string;
    displayName: string;
    abbreviation: string;
    color: string;
    group?: string;
    record?: string;
    recordStats?: Record<string, { value: number }>;
    logo: string;
    logoDark?: string;
  }>;
  odds?: {
    details: string;
    overUnder: number;
    spread: number;
    provider: { id: string; name: string };
    home?: { moneyLine: number };
    away?: { moneyLine: number };
    draw?: { moneyLine: number };
    homeTeamOdds?: { moneyLine: number };
    awayTeamOdds?: { moneyLine: number };
    drawOdds?: { moneyLine: number };
    moneyline?: Record<string, { close?: { odds?: string } }>;
    total?: { over?: { close?: { line: string } }; under?: { close?: { line: string } } };
  };
  fullStatus?: {
    type: { state: string; completed: boolean; detail: string };
    clock: number;
    addedClock: number;
    period: number;
    displayClock: string;
  };
}

interface HeaderLeague {
  slug: string;
  name: string;
  events: HeaderEvent[];
  logos?: Array<{ href: string; rel?: string[] }>;
}

interface HeaderSport {
  slug: string;
  name: string;
  leagues: HeaderLeague[];
}

interface HeaderResponse {
  sports: HeaderSport[];
}

// Per-league endpoint: events have nested competitions
interface PerLeagueEvent {
  id: string;
  date: string;
  name: string;
  status?: { type: { state: string; detail: string }; displayClock: string; period: number };
  venue?: { displayName: string };
  competitions: Array<{
    competitors: Array<{
      homeAway: "home" | "away";
      winner: boolean;
      score: string;
      form?: string;
      team?: {
        displayName: string;
        abbreviation: string;
        logo: string;
        color: string;
      };
      displayName?: string;
      abbreviation?: string;
      records?: Array<{ summary: string }>;
      statistics?: Array<{ name: string; displayValue: string }>;
    }>;
    odds?: object | null;
  }>;
}

interface PerLeagueResponse {
  leagues: Array<{ name: string; slug: string; logos?: Array<{ href: string }> }>;
  events: PerLeagueEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseScore(scoreStr: string): number | null {
  if (scoreStr === "" || scoreStr === undefined || scoreStr === null) return null;
  const n = Number(scoreStr);
  return Number.isFinite(n) ? n : null;
}

function parseOutcome(h: number | null, a: number | null): SportEvent["outcome"] {
  if (h === null || a === null) return null;
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

function parseStatus(state: string): SportEvent["status"] {
  if (state === "post") return "finished";
  if (state === "in" || state === "live") return "live";
  return "upcoming";
}

function resolveLeagueName(slug: string, fallbackName: string): string {
  const cfg = LEAGUE_CONFIG.get(slug);
  if (cfg) return cfg.name;
  // Clean up ESPN's verbose names
  return fallbackName
    .replace(/English /i, "")
    .replace(/Spanish /i, "")
    .replace(/French /i, "")
    .replace(/German /i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Map header event → SportEvent
// ---------------------------------------------------------------------------

function mapHeaderEvent(ev: HeaderEvent, leagueName: string, leagueLogo: string | null): SportEvent {
  const competitors = ev.competitors.slice().sort((a, b) => {
    if (a.homeAway === "home") return -1;
    if (b.homeAway === "home") return 1;
    return 0;
  });

  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null as unknown as SportEvent;

  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  const state = ev.fullStatus?.type?.state ?? ev.status ?? "pre";
  const status = parseStatus(state);

  return {
    id: `espn_${ev.id}`,
    event: `${home.displayName} vs ${away.displayName}`,
    homeTeam: home.displayName,
    awayTeam: away.displayName,
    homeBadge: home.logo || null,
    awayBadge: away.logo || null,
    leagueLogo,
    league: leagueName,
    sport: "Soccer",
    country: "",
    startsAt: ev.date,
    status,
    homeScore,
    awayScore,
    outcome: status === "finished" ? parseOutcome(homeScore, awayScore) : null,
    elapsed: ev.fullStatus?.period ?? ev.period ?? null,
  };
}

// ---------------------------------------------------------------------------
// Map per-league event → SportEvent
// ---------------------------------------------------------------------------

function mapPerLeagueEvent(ev: PerLeagueEvent, leagueName: string, leagueLogo: string | null): SportEvent | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors.slice().sort((a, b) => {
    if (a.homeAway === "home") return -1;
    if (b.homeAway === "home") return 1;
    return 0;
  });

  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const homeTeam = home.team ?? { displayName: home.displayName || "Unknown", abbreviation: home.abbreviation || "???", logo: "" };
  const awayTeam = away.team ?? { displayName: away.displayName || "Unknown", abbreviation: away.abbreviation || "???", logo: "" };

  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);

  const state = ev.status?.type?.state ?? "pre";
  const status = parseStatus(state);

  return {
    id: `espn_${ev.id}`,
    event: `${homeTeam.displayName} vs ${awayTeam.displayName}`,
    homeTeam: homeTeam.displayName,
    awayTeam: awayTeam.displayName,
    homeBadge: homeTeam.logo || null,
    awayBadge: awayTeam.logo || null,
    leagueLogo,
    league: leagueName,
    sport: "Soccer",
    country: "",
    startsAt: ev.date,
    status,
    homeScore,
    awayScore,
    outcome: status === "finished" ? parseOutcome(homeScore, awayScore) : null,
    elapsed: ev.status?.period ?? null,
  };
}

// ---------------------------------------------------------------------------
// HTTP fetch helper
// ---------------------------------------------------------------------------

async function espnFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status} for ${url}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

async function fetchFromHeader(): Promise<SportEvent[]> {
  const data = await espnFetch(`${ESPN_BASE}/apis/v2/scoreboard/header`) as HeaderResponse;
  const allEvents: SportEvent[] = [];

  const soccerSport = data.sports?.find((s) => s.slug === "soccer");
  if (!soccerSport) return allEvents;

  for (const league of soccerSport.leagues || []) {
    const leagueName = resolveLeagueName(league.slug, league.name);
    const leagueLogo = league.logos?.[0]?.href ?? null;

    for (const ev of league.events || []) {
      const mapped = mapHeaderEvent(ev, leagueName, leagueLogo);
      if (mapped) allEvents.push(mapped);
    }
  }

  return allEvents;
}

async function fetchPerLeague(slug: string, leagueName: string): Promise<SportEvent[]> {
  const data = await espnFetch(
    `${ESPN_BASE}/apis/site/v2/sports/soccer/${slug}/scoreboard`,
  ) as PerLeagueResponse;

  const resolvedName = resolveLeagueName(slug, leagueName);
  const leagueLogo = data.leagues?.[0]?.logos?.[0]?.href ?? null;
  const events: SportEvent[] = [];

  for (const ev of data.events || []) {
    const mapped = mapPerLeagueEvent(ev, resolvedName, leagueLogo);
    if (mapped) events.push(mapped);
  }

  return events;
}

// ---------------------------------------------------------------------------
// Cache + public API
// ---------------------------------------------------------------------------

const CACHE_TTL_MS       = 30 * 60 * 1000;  // 30 min
const CACHE_ERROR_TTL_MS = 5 * 60 * 1000;
const MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000;

function normalizeEventStatus(ev: SportEvent, now: number): SportEvent["status"] {
  if (ev.status !== "upcoming") return ev.status;
  const kickoff = new Date(ev.startsAt).getTime();
  if (kickoff <= now && kickoff > now - MAX_MATCH_DURATION_MS) return "live";
  return ev.status;
}

const espenSoccerCache = {
  upcoming: [] as SportEvent[],
  live: [] as SportEvent[],
  finished: [] as SportEvent[],
  fetchedAt: 0,
  suspended: false,
};

let refreshPromise: ReturnType<typeof fetchData> | null = null;

async function fetchData(): Promise<typeof espenSoccerCache> {
  let allEvents: SportEvent[] = [];
  let apiErrored = false;

  // Primary: header endpoint (one call = all leagues)
  try {
    allEvents = await fetchFromHeader();
  } catch (err) {
    logger.warn({ err }, "ESPN header fetch failed, falling back to per-league");
    apiErrored = true;

    // Fallback: fetch each configured league individually
    const leagueSlugs = [...LEAGUE_CONFIG.keys()];
    const perLeagueResults = await Promise.allSettled(
      leagueSlugs.map((slug) => {
        const cfg = LEAGUE_CONFIG.get(slug);
        return fetchPerLeague(slug, cfg?.name ?? slug);
      }),
    );

    for (const result of perLeagueResults) {
      if (result.status === "fulfilled") {
        allEvents.push(...result.value);
      } else {
        logger.warn({ err: result.reason }, "Per-league ESPN fetch failed");
      }
    }
  }

  if (allEvents.length === 0) {
    espenSoccerCache.fetchedAt = Date.now() - CACHE_TTL_MS + CACHE_ERROR_TTL_MS;
    const hasStale =
      espenSoccerCache.upcoming.length > 0 ||
      espenSoccerCache.live.length > 0 ||
      espenSoccerCache.finished.length > 0;
    espenSoccerCache.suspended = !hasStale;

    logger.warn(
      { hasStale },
      hasStale ? "ESPN error — serving stale cache" : "ESPN error — no data, suspending",
    );
    return { ...espenSoccerCache };
  }

  const now = Date.now();

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = allEvents.filter((ev) => {
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });

  const normalized = unique.map((ev) => ({ ...ev, status: normalizeEventStatus(ev, now) }));

  const upcoming = normalized
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      return new Date(ev.startsAt).getTime() > now;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const live = normalized
    .filter((ev) => ev.status === "live")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const finished = normalized
    .filter((ev) => ev.status === "finished")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 30);

  espenSoccerCache.upcoming = upcoming;
  espenSoccerCache.live = live;
  espenSoccerCache.finished = finished;
  espenSoccerCache.fetchedAt = now;
  espenSoccerCache.suspended = false;

  logger.info(
    { upcoming: upcoming.length, live: live.length, finished: finished.length, total: unique.length },
    "ESPN Soccer fixtures refreshed",
  );

  return { ...espenSoccerCache };
}

export async function getEspnSoccerEvents(
  forceRefresh = false,
): Promise<{
  upcoming: SportEvent[];
  live: SportEvent[];
  finished: SportEvent[];
  suspended: boolean;
}> {
  const cacheAge = Date.now() - espenSoccerCache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= 10 * 60 * 1000;

  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return { ...espenSoccerCache };
  }
  if (canForce) {
    logger.info({ cacheAgeMin: Math.round(cacheAge / 60_000) }, "ESPN Soccer force-refresh");
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = fetchData();
  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  if (!canForce && espenSoccerCache.fetchedAt > 0) {
    return { ...espenSoccerCache };
  }

  return refreshPromise;
}

// ---------------------------------------------------------------------------
// Single match lookup (settlement)
// ---------------------------------------------------------------------------

export async function fetchEspnSoccerMatch(eventId: string): Promise<SportEvent | null> {
  try {
    const events = await fetchFromHeader();
    return events.find((ev) => ev.id === eventId) ?? null;
  } catch {
    return null;
  }
}
