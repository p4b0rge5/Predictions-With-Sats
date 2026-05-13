/**
 * ESPN Multi-Sport scoreboard — single API call, ALL active sports
 *
 * Uses ESPN's /apis/v2/scoreboard/header endpoint which returns:
 *   Basketball (NBA, WNBA), Ice Hockey (NHL), Baseball (MLB), Soccer, Tennis, Golf, MMA, etc.
 *
 * - Free, no API key, no rate limits
 * - Single fetch → all sports' events in one response
 * - 30-minute cache
 * - Event IDs prefixed with "espn_" + sport-slug (e.g. "espn_nba_401871337")
 */

import { logger } from "./logger";
import type { SportEvent } from "./sports";

const ESPN_BASE = "https://site.api.espn.com";

// ---------------------------------------------------------------------------
// ESPN Header response types
// ---------------------------------------------------------------------------

interface HeaderTeam {
  id: string;
  uid: string;
  location: string;
  name: string;
  abbreviation: string;
  displayName: string;
  color: string;
  alternateColor: string;
  logoss?: Array<{ href: string; alt: string; width: number; height: number }>;
  links?: Array<{ href: string; rel: string[] }>;
}

interface HeaderCompetitor {
  id: string;
  uid: string;
  type: string;
  order: number;
  homeAway: string; // "home" | "away"
  winner: boolean | null;
  displayName: string;
  name: string;
  abbreviation: string;
  location: string;
  score: string;
  logo: string;
  logoDark?: string;
  record?: { summary: string; displayValue: string };
  records?: Array<{ type: string; summary: string; displayValue: string }>;
  form?: string; // soccer: "WWLDW"
  team?: HeaderTeam; // sometimes nested
}

interface HeaderEvent {
  id: string;
  uid: string;
  date: string;
  name: string;
  shortName: string;
  status: string; // "pre", "in", "post", "del", "can"
  summary: string;
  period?: number;
  clock?: string;
  competitors: HeaderCompetitor[];
  season?: number;
  seasonType?: string; // "2"=regular, "3"=postseason
  group?: { groupId: string; name: string; shortName: string };
  notes?: Array<{ text: string; headline: string; type: string }>;
  competitionType?: { slug: string; text: string };
  league?: { id: string; name: string };
  neutralSite?: boolean;
  seriesSummary?: string;
  // Soccer-specific
  addedClock?: string;
  playoff?: boolean;
  // Baseball-specific
  wasSuspended?: boolean;
  onFirst?: string;
  onSecond?: string;
  onThird?: string;
  outsText?: string;
  // Tennis-specific
  round?: string;
}

interface HeaderLeague {
  id: string;
  name: string;
  abbreviation: string;
  shortName: string;
  slug: string;
  tag?: string;
  logos?: Array<{ href: string; width: number; height: number }>;
  events: HeaderEvent[];
}

interface HeaderSport {
  id: string;
  name: string;
  slug: string;
  logos?: Array<{ href: string }>;
  leagues: HeaderLeague[];
}

interface HeaderResponse {
  sports: HeaderSport[];
}

// ---------------------------------------------------------------------------
// Sport slug → our internal sport mapping
// ---------------------------------------------------------------------------

const SPORT_MAP: Record<string, SportEvent["sport"]> = {
  basketball: "basketball",
  hockey: "hockey",
  baseball: "baseball",
  soccer: "football",
  // MMA not in ESPN scoreboard
  football: "football",
  tennis: "tennis",
  golf: "golf",
};

// Leagues we want to track (league slug → display name)
// Only include leagues that make sense for 2-outcome betting markets
const INCLUDED_LEAGUES: Record<string, string> = {
  // Basketball
  "nba": "NBA",
  "wnba": "WNBA",
  // Ice Hockey
  "nhl": "NHL",
  // Baseball
  "mlb": "MLB",
  // MMA — ESPN does not include MMA in scoreboard header
  // Soccer — these are handled by espn-soccer.ts instead
  // but we include them here as fallback
  "eng.1": "Premier League",
  "esp.1": "La Liga",
  "ita.1": "Serie A",
  "ger.1": "Bundesliga",
  "fra.1": "Ligue 1",
  "por.1": "Primeira Liga",
  "bra.1": "Brasileirão",
  "usa.1": "MLS",
  "uefa.europa": "Europa League",
};

// ---------------------------------------------------------------------------
// Status parsing
// ---------------------------------------------------------------------------

function parseEspnStatus(status: string): SportEvent["status"] {
  switch (status) {
    case "pre":
    case "set":
    case "sched":
      return "upcoming";
    case "in":
    case "live":
      return "live";
    case "post":
    case "comp":
    case "del":
    case "can":
      return "finished";
    default:
      return "upcoming";
  }
}

// ---------------------------------------------------------------------------
// Score parsing (ESPN scores are strings: "105", "3-2", "6-1 1-6")
// ---------------------------------------------------------------------------

function parseScore(scoreStr: string): number | null {
  if (!scoreStr || scoreStr === "-" || scoreStr === "TBD") return null;
  // For sports like baseball/football/soccer: single number "7", "3"
  const num = parseInt(scoreStr, 10);
  if (!isNaN(num)) return num;
  // For tennis "6-1 1-6 6-2" → return null (not a simple score)
  return null;
}

// ---------------------------------------------------------------------------
// Mapping function
// ---------------------------------------------------------------------------

function mapHeaderEvent(
  ev: HeaderEvent,
  sportSlug: string,
  leagueSlug: string,
  leagueName: string,
  leagueLogo: string | null,
): SportEvent | null {
  const competitors = ev.competitors || [];
  if (competitors.length < 2) return null;

  // Determine home/away — first non-home competitor is away, first "home" is home
  // In ESPN header: order=0 is usually away, order=1 is usually home
  const homeComp = competitors.find((c) => c.homeAway === "home") || competitors[1];
  const awayComp = competitors.find((c) => c.homeAway === "away") || competitors[0];

  const homeName = homeComp.displayName || homeComp.name || "";
  const awayName = awayComp.displayName || awayComp.name || "";
  const homeShort = homeComp.abbreviation || homeComp.location || "";
  const awayShort = awayComp.abbreviation || awayComp.location || "";

  if (!homeName || !awayName) return null;

  const homeScore = parseScore(homeComp.score);
  const awayScore = parseScore(awayComp.score);
  const status = parseEspnStatus(ev.status);

  // Determine outcome from winner flag or score comparison
  let outcome: SportEvent["outcome"] = null;
  if (status === "finished") {
    if (homeComp.winner === true) outcome = "home";
    else if (awayComp.winner === true) outcome = "away";
    else if (homeScore !== null && awayScore !== null) {
      if (homeScore > awayScore) outcome = "home";
      else if (awayScore > homeScore) outcome = "away";
      else outcome = "draw";
    }
  }

  // Badge URLs — ESPN logo field
  const homeBadge = homeComp.logo || null;
  const awayBadge = awayComp.logo || null;

  // Country — default from sport
  const countryMap: Record<string, string> = {
    basketball: "USA",
    hockey: "USA/Canada",
    baseball: "USA",
  };

  // League name override
  const displayName = INCLUDED_LEAGUES[leagueSlug] || leagueName;

  // Notes for playoff/series info
  const note = ev.notes?.find((n) => n.type === "event")?.text
    || ev.seriesSummary
    || null;

  const sportKey = `${sportSlug}`;
  const eventId = `espn_${sportSlug}_${ev.id}`;

  return {
    id: eventId,
    event: note
      ? `${homeShort} @ ${awayShort} — ${note}`
      : `${homeShort} @ ${awayShort}`,
    homeTeam: homeName,
    awayTeam: awayName,
    homeBadge,
    awayBadge,
    leagueLogo,
    league: displayName,
    sport: SPORT_MAP[sportSlug] || sportSlug,
    country: countryMap[sportSlug] || "International",
    startsAt: ev.date,
    status,
    homeScore,
    awayScore,
    outcome,
    elapsed: ev.period ? ev.period : null,
  };
}

// ---------------------------------------------------------------------------
// Cache (30-min TTL)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_ERROR_TTL_MS = 5 * 60 * 1000;

interface EspnSportCache {
  upcoming: SportEvent[];
  live: SportEvent[];
  finished: SportEvent[];
  suspended: false;
}

const espnMultiCache: Record<string, EspnSportCache & { fetchedAt: number }> = {};

// Initialize empty caches for all sports
const SPORT_SLUGS = ["basketball", "hockey", "baseball"];
for (const slug of SPORT_SLUGS) {
  espnMultiCache[slug] = { upcoming: [], live: [], finished: [], suspended: false, fetchedAt: 0 };
}

let refreshPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Fetch all sports from ESPN header
// ---------------------------------------------------------------------------

async function fetchEspnHeader(): Promise<HeaderResponse> {
  const url = `${ESPN_BASE}/apis/v2/scoreboard/header`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ESPN header HTTP ${res.status}`);
  return res.json() as Promise<HeaderResponse>;
}

// ---------------------------------------------------------------------------
// Public API — get events for a specific sport
// ---------------------------------------------------------------------------

export async function getEspnMultiSportEvents(
  sportSlug: string,
  forceRefresh = false,
): Promise<EspnSportCache> {
  const cache = espnMultiCache[sportSlug];
  const cacheAge = Date.now() - (cache?.fetchedAt ?? 0);
  const canForce = forceRefresh && cacheAge >= 10 * 60 * 1000;

  if (!canForce && cacheAge < CACHE_TTL_MS) {
    return cache || { upcoming: [], live: [], finished: [], fetchedAt: 0 };
  }

  if (refreshPromise) {
    return refreshPromise.then(() => cache || { upcoming: [], live: [], finished: [], fetchedAt: 0 });
  }

  refreshPromise = (async () => {
    try {
      const data = await fetchEspnHeader();
      const now = Date.now();

      for (const sport of data.sports) {
        const sSlug = sport.slug;
        const sCache = espnMultiCache[sSlug] ?? { upcoming: [], live: [], finished: [], fetchedAt: 0 };
        const allEvents: SportEvent[] = [];

        for (const league of sport.leagues) {
          const lName = league.shortName || league.name || league.slug;
          const lLogo = league.logos?.[0]?.href ?? null;

          for (const ev of league.events) {
            const mapped = mapHeaderEvent(ev, sSlug, league.slug, lName, lLogo);
            if (mapped) allEvents.push(mapped);
          }
        }

        sCache.upcoming = allEvents
          .filter((e) => e.status === "upcoming")
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        sCache.live = allEvents
          .filter((e) => e.status === "live")
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
        sCache.finished = allEvents
          .filter((e) => e.status === "finished")
          .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
          .slice(0, 30);
        sCache.fetchedAt = now;
        sCache.suspended = false;

        const total = sCache.upcoming.length + sCache.live.length + sCache.finished.length;
        logger.info(
          { upcoming: sCache.upcoming.length, live: sCache.live.length, finished: sCache.finished.length, total },
          `ESPN ${sport.name} (${sSlug}) fixtures refreshed`,
        );
      }

      logger.info(
        {
          sports: data.sports.map((s) => ({
            slug: s.slug,
            leagues: s.leagues.length,
            events: s.leagues.reduce((sum, l) => sum + l.events.length, 0),
          })),
        },
        "ESPN multi-sport header fetched",
      );
    } catch (err) {
      logger.warn({ err }, "ESPN multi-sport header fetch failed");
      throw err;
    }
  })();

  refreshPromise.catch(() => {}).finally(() => { refreshPromise = null; });

  return cache || { upcoming: [], live: [], finished: [], fetchedAt: 0 };
}

// ---------------------------------------------------------------------------
// Convenience exports per-sport
// ---------------------------------------------------------------------------

export function getEspnNbaEvents(forceRefresh = false) {
  return getEspnMultiSportEvents("basketball", forceRefresh);
}

export function getEspnNhlEvents(forceRefresh = false) {
  return getEspnMultiSportEvents("hockey", forceRefresh);
}

export function getEspnMlbEvents(forceRefresh = false) {
  return getEspnMultiSportEvents("baseball", forceRefresh);
}

// Note: ESPN does NOT include MMA/Fighting in the scoreboard header.
// MMA events are only available via API-Sports (see mma.ts).
