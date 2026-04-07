import https from "https";
import { logger } from "./logger";

const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

const LEAGUES = [
  { id: "4328", name: "Premier League",        sport: "Soccer" },
  { id: "4396", name: "English League 1",      sport: "Soccer" },
  { id: "4480", name: "UEFA Champions League", sport: "Soccer" },
  { id: "4351", name: "Brazilian Série A",     sport: "Soccer" },
  { id: "4335", name: "La Liga",               sport: "Soccer" },
  { id: "4332", name: "Serie A",               sport: "Soccer" },
  { id: "4331", name: "Bundesliga",            sport: "Soccer" },
  { id: "4334", name: "Ligue 1",               sport: "Soccer" },
  { id: "4387", name: "MLS",                   sport: "Soccer" },
];

export interface SportEvent {
  id:        string;
  event:     string;
  homeTeam:  string;
  awayTeam:  string;
  homeBadge: string | null;
  awayBadge: string | null;
  league:    string;
  sport:     string;
  startsAt:  string;
  status:    "upcoming" | "finished" | "live";
  homeScore: number | null;
  awayScore: number | null;
  outcome:   "home" | "away" | "draw" | null;
}

function httpGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function parseStatus(strStatus: string): SportEvent["status"] {
  const s = (strStatus || "").toLowerCase();
  if (s === "match finished" || s === "ft") return "finished";
  if (s === "in progress" || s === "1h" || s === "2h" || s === "ht") return "live";
  return "upcoming";
}

function parseOutcome(home: number | null, away: number | null): SportEvent["outcome"] {
  if (home === null || away === null) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(e: any): SportEvent {
  const homeScore = e.intHomeScore !== null && e.intHomeScore !== "" ? Number(e.intHomeScore) : null;
  const awayScore = e.intAwayScore !== null && e.intAwayScore !== "" ? Number(e.intAwayScore) : null;
  return {
    id:        String(e.idEvent),
    event:     e.strEvent,
    homeTeam:  e.strHomeTeam,
    awayTeam:  e.strAwayTeam,
    homeBadge: e.strHomeTeamBadge || null,
    awayBadge: e.strAwayTeamBadge || null,
    league:    e.strLeague,
    sport:     e.strSport,
    startsAt:  e.strTimestamp,
    status:    parseStatus(e.strStatus),
    homeScore,
    awayScore,
    outcome:   parseOutcome(homeScore, awayScore),
  };
}

const cache: { upcoming: SportEvent[]; finished: SportEvent[]; fetchedAt: number } = {
  upcoming: [],
  finished: [],
  fetchedAt: 0,
};
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes — refresh faster so finished games leave the list
const MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours — hide events older than this from "upcoming"

async function fetchLeague(endpoint: string): Promise<SportEvent[]> {
  const seen = new Set<string>();
  const results: SportEvent[] = [];
  for (const league of LEAGUES) {
    try {
      const url = `${SPORTSDB_BASE}/${endpoint}?id=${league.id}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await httpGet(url) as any;
      const events: SportEvent[] = (data.events || []).map(mapEvent);
      for (const e of events) {
        if (!seen.has(e.id)) { seen.add(e.id); results.push(e); }
      }
    } catch (err) {
      logger.warn({ err, league: league.id }, "Sports DB fetch failed for league");
    }
  }
  return results;
}

export async function getSportsEvents(): Promise<{ upcoming: SportEvent[]; finished: SportEvent[] }> {
  if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { upcoming: cache.upcoming, finished: cache.finished };
  }
  const [upcoming, finished] = await Promise.all([
    fetchLeague("eventsnextleague.php"),
    fetchLeague("eventspastleague.php"),
  ]);

  const now = Date.now();

  // TheSportsDB's eventsnextleague sometimes returns live/finished games.
  // Only show events that are truly upcoming: status must be "upcoming" AND
  // kickoff must not be more than MAX_MATCH_DURATION_MS in the past (safety net).
  const filteredUpcoming = upcoming
    .filter((ev) => {
      if (ev.status !== "upcoming") return false;
      const kickoff = new Date(ev.startsAt).getTime();
      return kickoff > now - MAX_MATCH_DURATION_MS;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  cache.upcoming  = filteredUpcoming;
  cache.finished  = finished.sort((a, b) => b.startsAt.localeCompare(a.startsAt)).slice(0, 20);
  cache.fetchedAt = Date.now();
  return { upcoming: cache.upcoming, finished: cache.finished };
}
