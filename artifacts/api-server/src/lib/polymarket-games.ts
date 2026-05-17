/**
 * Polymarket Sports Games — match-level events with results
 *
 * Uses Polymarket's gamma API:
 *   GET /sports                → list all 182+ sports/leagues
 *   GET /series/{seriesId}     → get all events (games) for a league
 *   GET /events?id={eventId}   → get full event with teams + markets (for settlement)
 *
 * Each match event has:
 *   - teams[] with name, logo (badge), abbreviation, color
 *   - markets[] with 3 outcomes (home win, draw, away win) + spread, O/U
 *   - Settlement via token.winner or outcomePrices (100%/0%)
 *
 * Unlike ESPN/API-Football, Polymarket provides:
 *   - Team badges via teams[].logo (direct S3 URLs)
 *   - 182+ leagues including Brasileirão, Brazil Série B, etc.
 *   - Resolution source URLs (e.g. cbf.com.br)
 *   - No API key, no rate limits
 */

import { logger } from "./logger";

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_API_BASE ?? "https://gamma-api.polymarket.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolymarketTeam {
  id: string;
  name: string;
  abbreviation: string | null;
  alias: string | null;
  logo: string | null;
  color: string | null;
  record: string | null;
  league: string | null;
}

export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  endDate: string;
  volume: number;
  liquidity: number;
  image: string | null;
  tokens?: Array<{ outcome: string; price: number; winner?: boolean }>;
}

export interface PolymarketGameEvent {
  // Core
  id: string;
  externalId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  league: string;
  sport: string;
  series: string;
  seriesSlug: string | null;
  sportSlug: string | null;

  // Teams
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  teams: PolymarketTeam[];

  // Timing
  startsAt: string | null;   // scheduled date
  endDate: string | null;     // resolution deadline
  createdAt: string | null;

  // Status
  status: "open" | "settled" | "closed";
  closed: boolean;
  active: boolean;
  archived: boolean;

  // Resolution
  winningOutcome: string | null;
  resolvedValue: string | null;
  settledAt: string | null;

  // Markets
  markets: PolymarketMarket[];

  // Metadata
  sourceUrl: string | null;
  resolutionSource: string | null;
  image: string | null;
  icon: string | null;
  volume: number | null;
  openInterest: number | null;
  liquidity: number | null;
}

export interface PolymarketSport {
  id: number;
  sport: string;
  image: string | null;
  resolution: string | null;
  ordering: string;
  tags: string;
  series: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Sport label mapping
// ---------------------------------------------------------------------------

const SPORT_LABELS: Record<string, string> = {
  // Soccer leagues
  epl: "Soccer",
  lal: "Soccer",
  bun: "Soccer",
  sea: "Soccer",
  fl1: "Soccer",
  acn: "Soccer",
  ere: "Soccer",
  arg: "Soccer",
  bra: "Soccer",
  bra2: "Soccer",
  mls: "Soccer",
  mex: "Soccer",
  por: "Soccer",
  ucl: "Soccer",
  uel: "Soccer",
  fr2: "Soccer",
  es2: "Soccer",
  bl2: "Soccer",
  den: "Soccer",
  j1: "Soccer",
  j2: "Soccer",
  rus: "Soccer",
  tur: "Soccer",
  sud: "Soccer",
  con: "Soccer",
  cof: "Soccer",
  uef: "Soccer",
  caf: "Soccer",
  efa: "Soccer",
  efl: "Soccer",
  fif: "Soccer",
  ofc: "Soccer",
  afc: "Soccer",
  val: "Esports",
  lcs: "Soccer",
  lib: "Soccer",

  // Other sports
  nba: "Basketball",
  nhl: "Hockey",
  mlb: "Baseball",
  nfl: "American Football",
  wnba: "Basketball",
  ncaab: "Basketball",
  cfb: "American Football",
  ipl: "Cricket",
  odi: "Cricket",
  t20: "Cricket",
  abb: "Cricket",
  csa: "Cricket",
  atp: "Tennis",
  wta: "Tennis",
  golf: "Golf",
  dota2: "Esports",
  lol: "Esports",
  cs2: "Esports",
};

// ---------------------------------------------------------------------------
// League label mapping
// ---------------------------------------------------------------------------

const LEAGUE_LABELS: Record<string, string> = {
  arg: "Argentine Primera",
  bl2: "2. Bundesliga",
  bra: "Brasileirao Serie A",
  bra2: "Brazil Serie B",
  bun: "Bundesliga",
  cfb: "College Football",
  den: "Danish Superliga",
  epl: "Premier League",
  ere: "Eredivisie",
  es2: "LaLiga 2",
  fl1: "Ligue 1",
  fr2: "Ligue 2",
  j1: "J1 League",
  j2: "J2 League",
  lal: "La Liga",
  mex: "Liga MX",
  mlb: "MLB",
  mls: "MLS",
  nfl: "NFL",
  nhl: "NHL",
  nba: "NBA",
  wnba: "WNBA",
  ncaab: "NCAA Basketball",
  por: "Primeira Liga",
  rus: "Russian Premier League",
  sea: "Serie A",
  sud: "Copa Sudamericana",
  tur: "Super Lig",
  ucl: "UEFA Champions League",
  uel: "UEFA Europa League",
  fif: "FIFA World Cup",
  ofc: "OFC Champions League",
  afc: "AFC Champions League",
  ipl: "IPL",
  atp: "ATP Tennis",
  wta: "WTA Tennis",
  gol: "Golf",
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function gammaFetch(path: string, signal?: AbortSignal): Promise<unknown> {
  const url = `${GAMMA_BASE}${path}`;
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Polymarket gamma API HTTP ${res.status} for ${path}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Fetch all sports/leagues
// ---------------------------------------------------------------------------

const sportsCache = { data: null as PolymarketSport[] | null, expiresAt: 0 };

export async function getPolymarketSports(): Promise<PolymarketSport[]> {
  if (sportsCache.data && Date.now() < sportsCache.expiresAt) {
    return sportsCache.data;
  }

  try {
    const data = await gammaFetch("/sports");
    if (!Array.isArray(data)) throw new Error("Unexpected response format");

    const parsed = (data as any[]).map((item) => ({
      id: Number(item.id),
      sport: String(item.sport),
      image: item.image ? String(item.image) : null,
      resolution: item.resolution ? String(item.resolution) : null,
      ordering: String(item.ordering ?? "home"),
      tags: String(item.tags ?? ""),
      series: String(item.series ?? ""),
      createdAt: String(item.createdAt ?? ""),
    })) as PolymarketSport[];

    sportsCache.data = parsed;
    sportsCache.expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    return parsed;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch Polymarket sports list");
    if (sportsCache.data) return sportsCache.data;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fetch series (league) with all events
// ---------------------------------------------------------------------------

interface RawSeriesResponse {
  id: string;
  slug: string;
  ticker: string;
  title: string;
  image: string;
  seriesType: string;
  active: boolean;
  closed: boolean;
  recurrence: string;
  volume24hr: number;
  events: Array<{
    id: string;
    title: string;
    markets: any[];
    closed: boolean;
    endDate: string;
    startDate: string;
    [key: string]: any;
  }>;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Fetch single event with full details (teams, markets, settlement)
// ---------------------------------------------------------------------------

export async function getEventById(eventId: string): Promise<PolymarketGameEvent | null> {
  const data = await gammaFetch(`/events?id=${eventId}&limit=1`);
  if (!Array.isArray(data) || data.length === 0) return null;

  const raw = data[0] as any;
  const teams = (raw.teams ?? []).map((t: any) => ({
    id: String(t.id),
    name: String(t.name),
    abbreviation: t.abbreviation ? String(t.abbreviation) : null,
    alias: t.alias ? String(t.alias) : null,
    logo: t.logo ? String(t.logo) : null,
    color: t.color ? String(t.color) : null,
    record: t.record ? String(t.record) : null,
    league: t.league ? String(t.league) : null,
  })) as PolymarketTeam[];

  const [homeTeam, awayTeam] = teams;
  const title = raw.title ? String(raw.title) : "";

  // Parse matchup from title for fallback
  const matchup = parseMatchup(title);

  // Parse start date from multiple fields
  const startsAt = parseStartsAt(raw);

  // Parse markets
  const markets = (raw.markets ?? []).map((m: any) => ({
    id: String(m.id),
    question: m.question ? String(m.question) : "",
    slug: m.slug ? String(m.slug) : "",
    outcomes: Array.isArray(m.outcomes) ? m.outcomes.map(String) : [],
    outcomePrices: Array.isArray(m.outcomePrices) ? m.outcomePrices.map(String) : [],
    endDate: m.endDate ? String(m.endDate) : "",
    volume: m.volumeNum ?? m.volume ?? 0,
    liquidity: m.liquidity ?? 0,
    image: m.image ? String(m.image) : null,
    tokens: m.tokens ? Array.isArray(m.tokens) ? m.tokens : [] : [],
  })) as PolymarketMarket[];

  // Determine winning outcome from markets
  const winningOutcome = determineWinningOutcome(markets, homeTeam?.name ?? null, awayTeam?.name ?? null);
  const resolvedValue = winningOutcome
    ? markets.find((m) => resolveMarketOutcomeKey(m) === winningOutcome)?.tokens?.find((t: any) => t.outcome)?.outcome ?? winningOutcome
    : null;

  // Determine status
  const isClosed = !!raw.closed;
  const isArchived = !!raw.archived;
  const status: PolymarketGameEvent["status"] = winningOutcome ? "settled" : (isClosed ? "closed" : "open");

  const endDate = raw.endDate ? String(raw.endDate) : null;

  return {
    id: "polymarket_" + String(raw.id),
    externalId: String(raw.id),
    slug: raw.slug ? String(raw.slug) : "",
    title: title,
    subtitle: raw.subtitle ? String(raw.subtitle) : null,
    description: raw.description ? String(raw.description) : null,
    league: raw.seriesSlug ? String(raw.seriesSlug) : "",
    sport: SPORT_LABELS[raw.seriesSlug ?? ""] ?? inferSportFromTitle(title) ?? "Soccer",
    series: raw.series ? String(raw.series) : "",
    seriesSlug: raw.seriesSlug ? String(raw.seriesSlug) : null,
    sportSlug: null,

    homeTeam: homeTeam?.name ?? matchup?.homeTeam ?? null,
    awayTeam: awayTeam?.name ?? matchup?.awayTeam ?? null,
    homeTeamId: homeTeam?.id ?? null,
    awayTeamId: awayTeam?.id ?? null,
    homeBadge: homeTeam?.logo ?? null,
    awayBadge: awayTeam?.logo ?? null,
    teams,

    startsAt,
    endDate,
    createdAt: raw.createdAt ? String(raw.createdAt) : null,

    status,
    closed: isClosed,
    active: !!raw.active,
    archived: isArchived,

    winningOutcome: winningOutcome ?? raw.winningOutcome ? String(raw.winningOutcome) : null,
    resolvedValue,
    settledAt: raw.settledAt ? String(raw.settledAt) : null,

    markets,

    sourceUrl: raw.sourceUrl ? String(raw.sourceUrl) : `https://polymarket.com/event/${raw.slug}`,
    resolutionSource: raw.resolutionSource ? String(raw.resolutionSource) : null,
    image: raw.image ? String(raw.image) : null,
    icon: raw.icon ? String(raw.icon) : null,
    volume: raw.volume ? Number(raw.volume) : null,
    openInterest: raw.openInterest ? Number(raw.openInterest) : null,
    liquidity: raw.liquidity ? Number(raw.liquidity) : null,
  };
}

// ---------------------------------------------------------------------------
// Parse start date from multiple Polymarket fields
// ---------------------------------------------------------------------------

function parseStartsAt(raw: any): string | null {
  const candidates = [
    raw.eventStartTime,
    raw.gameStartTime,
    raw.startTime,
    raw.eventDate,
    raw.startDate,
  ];

  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(String(c));
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Try parsing from description text: "scheduled for March 22, 2026 at 19:00 UTC"
  const desc = typeof raw.description === "string" ? raw.description : "";
  const scheduledMatch = desc.match(/scheduled for ([A-Za-z]+ \d{1,2}, \d{4})(?: at (\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?))?/i);
  if (scheduledMatch) {
    const dateStr = scheduledMatch[2]
      ? `${scheduledMatch[1]} ${scheduledMatch[2]} UTC`
      : `${scheduledMatch[1]} 12:00:00 UTC`;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parse matchup from title
// ---------------------------------------------------------------------------

function parseMatchup(title: string): { homeTeam: string; awayTeam: string } | null {
  // Remove " - More Markets" suffix
  const cleaned = title.replace(/\s+-\s+more markets$/i, "").trim();

  // "Home vs. Away" or "Home vs Away"
  const vsMatch = cleaned.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vsMatch) {
    return {
      homeTeam: vsMatch[1].trim(),
      awayTeam: vsMatch[2].trim(),
    };
  }

  // "Away at Home"
  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return {
      homeTeam: atMatch[2].trim(),
      awayTeam: atMatch[1].trim(),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Determine winning outcome from markets
// ---------------------------------------------------------------------------

function resolveMarketOutcomeKey(market: PolymarketMarket): string | null {
  // Match-level markets have patterns like:
  //   "Will [HomeTeam] win on 2026-03-22?" → "home"
  //   "Will [HomeTeam] vs. [AwayTeam] end in a draw?" → "draw"
  //   "Will [AwayTeam] win on 2026-03-22?" → "away"
  const q = market.question.toLowerCase();

  if (q.includes("end in a draw") || q.includes("end in a tie") || q.includes("draw?")) return "draw";
  if (q.includes("win on") || q.includes("win on ")) {
    // The team name in the question determines home vs away
    return null; // needs team name context
  }

  return null;
}

function determineWinningOutcome(
  markets: PolymarketMarket[],
  homeTeamName: string | null,
  awayTeamName: string | null,
): string | null {
  for (const m of markets) {
    // Check via tokens[].winner (most reliable)
    if (Array.isArray(m.tokens) && m.tokens.length > 0) {
      for (const token of m.tokens) {
        if (token.winner === true) {
          const outcome = token.outcome;
          if (typeof outcome === "string") {
            return resolveOutcomeKey(m.question, outcome, homeTeamName, awayTeamName);
          }
        }
      }
    }

    // Check via outcomePrices (100%/0% means resolved)
    if (Array.isArray(m.outcomePrices) && m.outcomePrices.length >= 2) {
      const prices = m.outcomePrices.map(Number);
      if (prices.some((p) => p >= 100 || p <= 0.01)) {
        const resolved = prices[0] >= 100 ? m.outcomes[0] : prices[1] >= 100 ? m.outcomes[1] : null;
        if (resolved) {
          const key = resolveOutcomeKey(m.question, String(resolved), homeTeamName, awayTeamName);
          if (key) return key;
        }
      }
    }
  }

  return null;
}

function resolveOutcomeKey(
  question: string,
  outcome: string,
  homeTeamName: string | null,
  awayTeamName: string | null,
): string | null {
  const q = question.toLowerCase();
  const o = String(outcome).toLowerCase();

  // Draw market
  if (q.includes("draw") || q.includes("tie")) return "draw";

  // Yes/No market for a team
  if (o === "yes") {
    if (homeTeamName && (o.includes(homeTeamName.toLowerCase()) || question.toLowerCase().includes(homeTeamName.toLowerCase()))) return "home";
    if (awayTeamName && question.toLowerCase().includes(awayTeamName.toLowerCase())) return "away";
  }

  // Direct team name outcome
  if (homeTeamName && o.includes(homeTeamName.toLowerCase())) return "home";
  if (awayTeamName && o.includes(awayTeamName.toLowerCase())) return "away";

  return null;
}

// ---------------------------------------------------------------------------
// Infer sport from title
// ---------------------------------------------------------------------------

function inferSportFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/\b(fc|cf|sc|fk|sk|ec|ca|cd|ud|ac|afc|calcio|futebol|fotball)\b/.test(t)) return "Soccer";
  if (/\b(basket|baskets|basketball|pallacanestro|baloncesto|basquete)\b/.test(t)) return "Basketball";
  if (/\b(mlb|baseball|diamond)\b/.test(t)) return "Baseball";
  if (/\b(nhl|hockey|puck)\b/.test(t)) return "Hockey";
  if (/\b(nfl|football|touchdown)\b/.test(t)) return "American Football";
  if (/\b(ufc|mma|fight|kickboxing)\b/.test(t)) return "MMA";
  return "Soccer"; // default
}

// ---------------------------------------------------------------------------
// League presentation
// ---------------------------------------------------------------------------

export function getLeagueLabel(seriesSlug: string): string {
  return LEAGUE_LABELS[seriesSlug] ?? seriesSlug;
}

export function getLeagueLogo(seriesSlug: string): string | null {
  const logos: Record<string, string> = {
    epl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Repetitive-markets/premier+league.jpg",
    bun: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-bun.jpg",
    bl2: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-bun.jpg",
    es2: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-lal.png",
    fl1: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-fl1.png",
    fr2: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-fl1.png",
    lal: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-lal.png",
    mlb: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Repetitive-markets/MLB.jpg",
    nfl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/nfl.png",
    nhl: "https://polymarket-upload.s3.us-east-2.amazonaws.com/nhl.png",
    sea: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Serie-A-Logo.png",
    cfb: "https://polymarket-upload.s3.us-east-2.amazonaws.com/espn+college+football+logo.png",
  };
  return logos[seriesSlug] ?? null;
}

// ---------------------------------------------------------------------------
// Sport normalization (for frontend icon/display)
// ---------------------------------------------------------------------------

export function normalizePolymarketSport(seriesSlug: string, title: string): string {
  // Check explicit mapping first
  if (SPORT_LABELS[seriesSlug]) return SPORT_LABELS[seriesSlug];

  // Infer from title
  const inferred = inferSportFromTitle(title);
  return inferred;
}

// ---------------------------------------------------------------------------
// Fetch active events for a sport (batch)
// ---------------------------------------------------------------------------

const seriesCache = new Map<string, { data: { series: any; events: any[] }; expiresAt: number }>();

export async function getSeriesEvents(seriesId: string): Promise<{
  series: { id: string; slug: string; ticker: string; title: string; volume24hr: number };
  events: Array<{ id: string; title: string; closed: boolean; endDate: string; markets: any[] }>;
}> {
  const cached = seriesCache.get(seriesId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const data = await gammaFetch(`/series/${seriesId}`) as any;

  const result = {
    series: {
      id: data.id,
      slug: data.slug,
      ticker: data.ticker,
      title: data.title,
      volume24hr: data.volume24hr ?? 0,
    },
    events: (data.events ?? []).map((e: any) => ({
      id: String(e.id),
      title: String(e.title),
      closed: !!e.closed,
      endDate: e.endDate ?? null,
      markets: e.markets ?? [],
    })),
  };

  seriesCache.set(seriesId, {
    data: result,
    expiresAt: Date.now() + 15 * 60 * 1000, // 15 min
  });

  return result;
}

// ---------------------------------------------------------------------------
// Fetch active events for multiple leagues (batch for frontend)
// ---------------------------------------------------------------------------

const GAMES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface PolymarketGamesCache {
  byLeague: Map<string, { events: PolymarketGameEvent[]; settled: PolymarketGameEvent[]; fetchedAt: number }>;
  allEvents: PolymarketGameEvent[];
  allSettled: PolymarketGameEvent[];
  fetchedAt: number;
  suspended: boolean;
}

const gamesCache: PolymarketGamesCache = {
  byLeague: new Map(),
  allEvents: [],
  allSettled: [],
  fetchedAt: 0,
  suspended: false,
};

// Curated list of leagues to show (by sport slug from /sports endpoint)
const FEATURED_SPORT_SLUGS = new Set([
  // Soccer leagues
  "epl", "lal", "bun", "sea", "fl1", "acn", "ere", "arg",
  "bra", "bra2", "mls", "mex", "por", "ucl", "uel", "fr2", "es2",
  "bl2", "den", "j1", "j2", "rus", "tur", "sud", "con", "cof",
  "uef", "caf", "efa", "efl", "fif", "ofc", "afc", "val", "lcs", "lib",
  // Other sports
  "nba", "nhl", "mlb", "nfl", "wnba", "ncaab", "cfb",
  "ipl", "odi", "t20", "abb", "csa",
  "atp", "wta", "golf",
]);

const MAX_EVENTS_PER_LEAGUE = 30;
const MAX_SETTLED_PER_LEAGUE = 15;

export async function fetchPolymarketGames(
  forceRefresh = false,
  leagueFilter?: string,
): Promise<{
  events: PolymarketGameEvent[];
  settled: PolymarketGameEvent[];
  suspended: boolean;
  leagueCount: number;
}> {
  const cacheAge = Date.now() - gamesCache.fetchedAt;
  if (!forceRefresh && cacheAge < GAMES_CACHE_TTL_MS && gamesCache.allEvents.length > 0) {
    const allFiltered = leagueFilter
      ? gamesCache.allEvents.filter((e) =>
          e.seriesSlug === leagueFilter ||
          (e.sportSlug && e.sportSlug.toLowerCase() === leagueFilter.toLowerCase()) ||
          e.league.toLowerCase().includes(leagueFilter.toLowerCase()),
        )
      : gamesCache.allEvents;
    const settledFiltered = leagueFilter
      ? gamesCache.allSettled.filter((e) =>
          e.seriesSlug === leagueFilter ||
          (e.sportSlug && e.sportSlug.toLowerCase() === leagueFilter.toLowerCase()) ||
          e.league.toLowerCase().includes(leagueFilter.toLowerCase()),
        )
      : gamesCache.allSettled;
    return {
      events: allFiltered,
      settled: settledFiltered,
      suspended: gamesCache.suspended,
      leagueCount: gamesCache.byLeague.size,
    };
  }

  const sports = await getPolymarketSports();
  const filteredSports = leagueFilter
    ? sports.filter((s) => s.sport === leagueFilter || s.sport === leagueFilter)
    : sports.filter((s) => FEATURED_SPORT_SLUGS.has(s.sport));

  const allOpenEvents: PolymarketGameEvent[] = [];
  const allSettledEvents: PolymarketGameEvent[] = [];
  let errors = 0;

  // Fetch series for each league (light — just series-level data, no per-event fetch)
  const batchSize = 10;
  for (let i = 0; i < filteredSports.length; i += batchSize) {
    const batch = filteredSports.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (sport) => {
        try {
          const series = await getSeriesEvents(sport.series);

          // Parse events directly from series response (light, no individual fetch)
          const now = new Date();
          const open = series.events
            .filter((e) => !e.closed)
            .slice(0, MAX_EVENTS_PER_LEAGUE)
            .map((e) => seriesEventToGame(e, sport.sport, series.series));

          const settled = series.events
            .filter((e) => e.closed)
            .slice(0, MAX_SETTLED_PER_LEAGUE)
            .map((e) => seriesEventToGame(e, sport.sport, series.series));

          return { sportSlug: sport.sport, open, settled };
        } catch (err) {
          logger.warn({ err, seriesId: sport.series, sport: sport.sport }, "Failed to fetch Polymarket series");
          return { sportSlug: sport.sport, open: [], settled: [] };
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { sportSlug, open, settled } = result.value;
        gamesCache.byLeague.set(sportSlug, {
          events: open,
          settled,
          fetchedAt: Date.now(),
        });
        allOpenEvents.push(...open);
        allSettledEvents.push(...settled);
      } else {
        errors++;
      }
    }
  }

  // Sort open events by endDate (earliest first = most urgent)
  allOpenEvents.sort((a, b) => {
    const aTime = a.endDate ? new Date(a.endDate).getTime() : Infinity;
    const bTime = b.endDate ? new Date(b.endDate).getTime() : Infinity;
    return aTime - bTime;
  });

  // Sort settled events by endDate (most recent first)
  allSettledEvents.sort((a, b) => {
    const aTime = a.endDate ? new Date(a.endDate).getTime() : 0;
    const bTime = b.endDate ? new Date(b.endDate).getTime() : 0;
    return bTime - aTime;
  });

  // Deduplicate by externalId
  const seenIds = new Set<string>();
  const deduplicatedOpen = allOpenEvents.filter((e) => {
    if (seenIds.has(e.externalId)) return false;
    seenIds.add(e.externalId);
    return true;
  });

  // Enrich with league label
  const enriched = deduplicatedOpen.map((e) => ({
    ...e,
    league: getLeagueLabel(e.seriesSlug ?? e.league),
  }));

  const suspended = errors >= filteredSports.length;

  gamesCache.allEvents = enriched;
  gamesCache.allSettled = allSettledEvents;
  gamesCache.fetchedAt = Date.now();
  gamesCache.suspended = suspended;

  logger.info(
    {
      leagues: filteredSports.length,
      events: enriched.length,
      settled: allSettledEvents.length,
      errors,
      suspended,
      filtered: !!leagueFilter,
    },
    "Polymarket games refreshed",
  );

  return {
    events: leagueFilter
      ? enriched.filter((e) => e.seriesSlug === leagueFilter || e.league === leagueFilter)
      : enriched,
    settled: leagueFilter
      ? allSettledEvents.filter((e) => e.seriesSlug === leagueFilter || e.league === leagueFilter)
      : allSettledEvents,
    suspended,
    leagueCount: gamesCache.byLeague.size,
  };
}

// ---------------------------------------------------------------------------
// Convert series event (light) to PolymarketGameEvent
// ---------------------------------------------------------------------------

function seriesEventToGame(
  e: { id: string; title: string; closed: boolean; endDate: string; markets: any[] },
  sportSlug: string,
  series: { id: string; slug: string; ticker: string; title: string },
): PolymarketGameEvent {
  const matchup = parseMatchup(e.title);

  return {
    id: "polymarket_" + e.id,
    externalId: e.id,
    slug: e.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 100),
    title: e.title.replace(/\s+-\s+more markets$/i, "").trim(),
    subtitle: null,
    description: null,
    league: series.slug,
    sport: SPORT_LABELS[sportSlug] ?? normalizePolymarketSport(sportSlug, e.title),
    series: series.id,
    seriesSlug: series.slug,
    sportSlug,

    homeTeam: matchup?.homeTeam ?? null,
    awayTeam: matchup?.awayTeam ?? null,
    homeTeamId: null,
    awayTeamId: null,
    homeBadge: null,
    awayBadge: null,
    teams: [],

    startsAt: null, // series response doesn't include start dates — getEventById fills this
    endDate: e.endDate || null,
    createdAt: null,

    status: e.closed ? "closed" : "open",
    closed: e.closed,
    active: !e.closed,
    archived: false,

    winningOutcome: null, // need getEventById for this
    resolvedValue: null,
    settledAt: null,

    markets: [],
    sourceUrl: null,
    resolutionSource: null,
    image: null,
    icon: null,
    volume: null,
    openInterest: null,
    liquidity: null,
  };
}

// ---------------------------------------------------------------------------
// Check settlement for a single event (used by settlement poller)
// ---------------------------------------------------------------------------

export async function checkEventSettlement(eventId: string): Promise<{
  settled: boolean;
  winningOutcome: string | null;
  resolvedValue: string | null;
} | null> {
  try {
    const event = await getEventById(eventId);
    if (!event) return null;

    return {
      settled: event.status === "settled",
      winningOutcome: event.winningOutcome,
      resolvedValue: event.resolvedValue,
    };
  } catch (err) {
    logger.warn({ err, eventId }, "Failed to check event settlement");
    return null;
  }
}
