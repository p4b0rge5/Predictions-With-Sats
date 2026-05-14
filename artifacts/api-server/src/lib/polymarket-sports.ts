import { logger } from "./logger";
import {
  fetchGammaSidecarEventBySlug,
  fetchGammaSidecarSports,
  fetchGammaSidecarTeams,
} from "./polymarket-gamma-sidecar";

const GAMMA_API_BASE = process.env.POLYMARKET_GAMMA_API_BASE ?? "https://gamma-api.polymarket.com";
const SPORTS_TAG_SLUG = process.env.POLYMARKET_SPORTS_TAG_SLUG ?? "sports";
const SPORTS_ROOT_TAG_ID = process.env.POLYMARKET_SPORTS_TAG_ID?.trim() || null;
const PAGE_LIMIT = 100;
const MAX_ACTIVE_PAGES = 8;
const MAX_CLOSED_PAGES = 4;
const FUTURE_DAYS = 5;
const MARKET_FETCH_CACHE_TTL_MS = 10 * 60 * 1000;

const LEAGUE_PRESENTATION_BY_CODE: Record<string, { label: string; logo: string | null }> = {
  arg: { label: "Argentine Primera", logo: null },
  bl2: { label: "2. Bundesliga", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-bun.jpg" },
  bra: { label: "Brasileirao Serie A", logo: null },
  bkbbl: { label: "BBL", logo: null },
  bkaba: { label: "ABA League", logo: null },
  bkarg: { label: "Liga Nacional", logo: null },
  bkcba: { label: "CBA", logo: null },
  bkfr1: { label: "LNB Pro A", logo: null },
  bkjpn: { label: "B.League", logo: null },
  bkkbl: { label: "KBL", logo: null },
  bkligend: { label: "Liga Endesa", logo: null },
  bkseriea: { label: "Lega Basket Serie A", logo: null },
  bun: { label: "Bundesliga", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-bun.jpg" },
  cfb: { label: "College Football", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/espn+college+football+logo.png" },
  den: { label: "Danish Superliga", logo: null },
  epl: { label: "Premier League", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Repetitive-markets/premier+league.jpg" },
  ere: { label: "Eredivisie", logo: null },
  es2: { label: "LaLiga 2", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-lal.png" },
  euroleague: { label: "EuroLeague", logo: null },
  fl1: { label: "Ligue 1", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-fl1.png" },
  fr2: { label: "Ligue 2", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-fl1.png" },
  j1: { label: "J1 League", logo: null },
  j2: { label: "J2 League", logo: null },
  j1100: { label: "J1 League", logo: null },
  j2100: { label: "J2 League", logo: null },
  lal: { label: "La Liga", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/league-lal.png" },
  mex: { label: "Liga MX", logo: null },
  mlb: { label: "MLB", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Repetitive-markets/MLB.jpg" },
  mls: { label: "MLS", logo: null },
  nfl: { label: "NFL", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/nfl.png" },
  nhl: { label: "NHL", logo: null },
  nor: { label: "Eliteserien", logo: null },
  por: { label: "Primeira Liga", logo: null },
  rus: { label: "Russian Premier League", logo: null },
  sea: { label: "Serie A", logo: "https://polymarket-upload.s3.us-east-2.amazonaws.com/Serie-A-Logo.png" },
  sud: { label: "Copa Sudamericana", logo: null },
  tur: { label: "Super Lig", logo: null },
  ucl: { label: "UEFA Champions League", logo: null },
};

export interface ExternalSportPolyOutcome {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
  sourceMarketId?: string;
  sortOrder?: number;
}

export interface ExternalSportPolyMarket {
  externalMarketId: string;
  provider: "polymarket";
  eventName: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league: string;
  sport: string;
  startsAt: Date;
  question: string;
  subtitle: string | null;
  sourceUrl: string | null;
  status: "open" | "settled";
  winningOutcome: string | null;
  resolvedValue: string | null;
  settledAt: Date | null;
  outcomes: ExternalSportPolyOutcome[];
  relevanceRank?: number;
}

interface PolymarketTokenLike {
  outcome?: unknown;
  price?: unknown;
  winner?: unknown;
}

interface PolymarketTagLike {
  label?: unknown;
  slug?: unknown;
}

interface PolymarketSportMetaLike {
  sport?: unknown;
  image?: unknown;
  resolution?: unknown;
  ordering?: unknown;
  series?: unknown;
  tags?: unknown;
}

interface PolymarketTeamLike {
  id?: unknown;
  name?: unknown;
  league?: unknown;
  record?: unknown;
  logo?: unknown;
  abbreviation?: unknown;
  alias?: unknown;
}

interface PolymarketEventLike {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  startDate?: unknown;
  startTime?: unknown;
  eventStartTime?: unknown;
  gameStartTime?: unknown;
  eventDate?: unknown;
  endDate?: unknown;
  closedTime?: unknown;
  image?: unknown;
  icon?: unknown;
  featuredImage?: unknown;
  seriesSlug?: unknown;
  volume?: unknown;
  volume24hr?: unknown;
  liquidity?: unknown;
  competitive?: unknown;
}

interface PolymarketMarketLike {
  id?: unknown;
  slug?: unknown;
  question?: unknown;
  title?: unknown;
  description?: unknown;
  subtitle?: unknown;
  groupItemTitle?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  tokens?: unknown;
  startDate?: unknown;
  startTime?: unknown;
  eventStartTime?: unknown;
  endDate?: unknown;
  end_date_iso?: unknown;
  gameStartTime?: unknown;
  closedTime?: unknown;
  updatedAt?: unknown;
  volume?: unknown;
  volume24hr?: unknown;
  liquidity?: unknown;
  competitive?: unknown;
  category?: unknown;
  sportsMarketType?: unknown;
  image?: unknown;
  icon?: unknown;
  teamAID?: unknown;
  teamBID?: unknown;
  tags?: unknown;
  events?: unknown;
}

interface PolymarketOfficialTeam {
  id: string;
  name: string;
  league: string | null;
  logo: string | null;
  abbreviation: string | null;
  alias: string | null;
}

interface PolymarketOfficialMetadata {
  teams: PolymarketOfficialTeam[];
  teamById: Map<string, PolymarketOfficialTeam>;
  sportImageBySlug: Map<string, string>;
  sportImageByLabel: Map<string, string>;
}

export interface PolymarketOfficialPresentationInput {
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  league: string;
  sport: string;
  sourceUrl: string | null;
  leagueLogo: string | null;
}

export interface PolymarketOfficialPresentation {
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
}

interface GroupableSportsOutcome {
  sourceMarketId: string;
  sourceUrl: string | null;
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league: string;
  sport: string;
  startsAt: Date;
  question: string;
  subtitle: string | null;
  outcomeKey: "home" | "draw" | "away";
  outcomeLabel: string;
  price: number | null;
  isWinner: boolean | null;
  settledAt: Date | null;
  sourceRank: number;
  relevanceVolume: number | null;
  relevanceVolume24hr: number | null;
  relevanceLiquidity: number | null;
  relevanceCompetitive: number | null;
}

interface DirectSportsMarket {
  groupKey: string;
  market: ExternalSportPolyMarket;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePercent(value: unknown): number | null {
  const num = asNumber(value);
  if (num === null) return null;
  return num <= 1 ? num * 100 : num;
}

function tryParseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function normalizeSportLabel(value: string | null): string | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();
  if (normalized === "soccer" || normalized === "football") return "Soccer";
  if (normalized === "basketball") return "Basketball";
  if (normalized === "baseball") return "Baseball";
  if (normalized === "american-football" || normalized === "american football") return "American Football";
  if (normalized === "hockey" || normalized === "ice hockey" || normalized === "nhl") return "Hockey";
  if (normalized === "mma" || normalized === "zuffa") return "MMA";
  if (normalized === "rugby") return "Rugby";
  if (normalized === "tennis") return "Tennis";
  if (normalized === "golf") return "Golf";
  if (normalized === "cricket") return "Cricket";
  return null;
}

function extractLeagueCodeFromSourceUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;

  try {
    const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() ?? "";
    const [prefix] = slug.split("-");
    return prefix ? prefix.toLowerCase() : null;
  } catch {
    const [prefix] = sourceUrl.toLowerCase().split("-");
    return prefix || null;
  }
}

function inferSportFromSlugContext(slugContext: string): string | null {
  const source = slugContext.toLowerCase();

  if (/(?:^|\s)bk[a-z0-9]+-/.test(source)) return "Basketball";
  if (/(?:^|\s)euroleague-/.test(source)) return "Basketball";
  if (/(?:^|\s)(?:mma|ufc|pfl|bellator)-/.test(source)) return "MMA";
  if (/(?:^|\s)(?:nhl|ahl|khl|shl|ligaen)-/.test(source)) return "Hockey";
  if (/(?:^|\s)(?:mlb|npb|kbo)-/.test(source)) return "Baseball";
  if (/(?:^|\s)(?:nfl|cfb|xfl|usfl|cfl)-/.test(source)) return "American Football";
  if (/(?:^|\s)(?:ten|atp|wta|challenger)-/.test(source)) return "Tennis";
  if (/(?:^|\s)(?:golf|pga|liv)-/.test(source)) return "Golf";
  if (/(?:^|\s)(?:rug|urc|sixnations|superrugby)-/.test(source)) return "Rugby";
  if (
    /(?:^|\s)(?:arg|aus|aut|bel|bl2|bra|chi|col|cro|cze|den|ecu|eng|epl|ere|es1|es2|fin|fra|fr1|fr2|ger|ger2|gre|hun|irl|isa|isb|itsa|itsb|j1|j2|j[0-9]+|kor|lat|lib|mls|mex|ned|nor|par|per|pol|por|rom|rus|sco|srb|sud|sui|svk|svn|swe|tur|ucl|uefa|uru|ven)-/.test(source)
  ) {
    return "Soccer";
  }

  return null;
}

function inferSportFromParticipants(eventName: string): string | null {
  const source = normalizeComparable(eventName);

  if (
    /\b(basket|baskets|basketball|pallacanestro|baloncesto|basquete|baskonia|olimpija|promy|eagles|rockets|sharks|knicks|lakers|warriors|celtics)\b/.test(source)
  ) {
    return "Basketball";
  }

  if (
    /\b(fc|cf|sc|fk|sk|ec|ca|cd|ud|ac|afc|calcio|futebol|fotball|fbc|unam|benfica|sporting|palmeiras|coritiba|botafogo|river plate|rosario central|newell s old boys)\b/.test(source)
  ) {
    return "Soccer";
  }

  return null;
}

function normalizeComparable(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokenPairs(raw: PolymarketMarketLike): Array<{ label: string; price: number | null; winner: boolean | null }> {
  if (Array.isArray(raw.tokens) && raw.tokens.length > 0) {
    return (raw.tokens as PolymarketTokenLike[]).flatMap((token) => {
      const label = asString(token.outcome);
      if (!label) return [];
      return [{
        label,
        price: normalizePercent(token.price),
        winner: token.winner === true ? true : token.winner === false ? false : null,
      }];
    });
  }

  const labels = tryParseJsonArray(raw.outcomes)
    .map((value) => asString(value))
    .filter((value): value is string => value !== null);
  const prices = tryParseJsonArray(raw.outcomePrices);

  return labels.map((label, index) => ({
    label,
    price: normalizePercent(prices[index]),
    winner: null,
  }));
}

function getYesInfo(raw: PolymarketMarketLike): { yesPrice: number | null; resolvedTruth: boolean | null } | null {
  const pairs = getTokenPairs(raw);
  if (pairs.length < 2) return null;

  const yes = pairs.find((pair) => pair.label.toLowerCase() === "yes");
  const no = pairs.find((pair) => pair.label.toLowerCase() === "no");
  if (!yes || !no) return null;

  const resolvedTruth =
    yes.winner === true ? true :
    no.winner === true ? false :
    yes.price !== null && yes.price >= 99 ? true :
    no.price !== null && no.price >= 99 ? false :
    null;

  return {
    yesPrice: yes.price,
    resolvedTruth,
  };
}

function toAbsolutePolymarketUrl(slug: string | null): string | null {
  return slug ? `https://polymarket.com/event/${slug}` : null;
}

function getPrimaryEvent(raw: PolymarketMarketLike): PolymarketEventLike | null {
  if (!Array.isArray(raw.events) || raw.events.length === 0) return null;
  const [first] = raw.events;
  return first && typeof first === "object" ? (first as PolymarketEventLike) : null;
}

function parseScheduledDateText(value: string | null): Date | null {
  if (!value) return null;

  const isoMatch = value.match(/scheduled\s+for\s+(\d{4}-\d{2}-\d{2})/i);
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const monthMatch = value.match(
    /scheduled\s+for\s+([A-Za-z]+ \d{1,2}, \d{4})(?:\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?))?/i,
  );
  if (!monthMatch) return null;

  const dateText = monthMatch[2]
    ? `${monthMatch[1]} ${monthMatch[2]} UTC`
    : `${monthMatch[1]} 12:00:00 UTC`;
  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractStartsAt(raw: PolymarketMarketLike, event: PolymarketEventLike | null): Date | null {
  const exactCandidate =
    parseExactDateCandidate(asString(raw.eventStartTime)) ??
    parseExactDateCandidate(asString(raw.gameStartTime)) ??
    parseExactDateCandidate(asString(raw.startDate)) ??
    parseExactDateCandidate(asString(raw.startTime)) ??
    parseExactDateCandidate(asString(event?.eventStartTime)) ??
    parseExactDateCandidate(asString(event?.gameStartTime)) ??
    parseExactDateCandidate(asString(event?.startTime)) ??
    parseExactDateCandidate(asString(event?.eventDate)) ??
    parseExactDateCandidate(asString(event?.startDate));
  if (exactCandidate) return exactCandidate;

  const subtitleDate = parseScheduledDateText(asString(raw.subtitle) ?? asString(raw.description) ?? asString(event?.subtitle) ?? asString(event?.description));
  if (subtitleDate) return subtitleDate;

  const candidate =
    asString(event?.startDate) ??
    asString(raw.startDate) ??
    asString(raw.eventStartTime) ??
    asString(raw.gameStartTime) ??
    asString(raw.startTime) ??
    asString(raw.endDate) ??
    asString(raw.end_date_iso) ??
    asString(event?.eventStartTime) ??
    asString(event?.gameStartTime) ??
    asString(event?.startTime) ??
    asString(event?.endDate) ??
    asString(raw.closedTime) ??
    asString(event?.closedTime) ??
    null;

  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function withinDateWindow(startsAt: Date | null): boolean {
  if (!startsAt) return false;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + FUTURE_DAYS + 1);

  return startsAt.getTime() >= start.getTime() && startsAt.getTime() < endExclusive.getTime();
}

function parseMatchup(text: string): { homeTeam: string; awayTeam: string } | null {
  const cleaned = text
    .replace(/\s+-\s+more markets$/i, "")
    .replace(/\s+\([^)]*\)\s*$/, "")
    .trim();

  const directMatch = cleaned.match(/^(.+?)\s+vs\.?\s+(.+)$/i) ?? cleaned.match(/^(.+?)\s+v\.?\s+(.+)$/i);
  if (directMatch) {
    return {
      homeTeam: directMatch[1].trim(),
      awayTeam: directMatch[2].trim(),
    };
  }

  const atMatch = cleaned.match(/^(.+?)\s+at\s+(.+)$/i) ?? cleaned.match(/^(.+?)\s+@\s+(.+)$/i);
  if (atMatch) {
    return {
      homeTeam: atMatch[2].trim(),
      awayTeam: atMatch[1].trim(),
    };
  }

  return null;
}

function inferLeague(raw: PolymarketMarketLike, slugContext: string): string {
  const category = asString(raw.category);
  if (category && category.toLowerCase() !== "sports") return category;

  if (Array.isArray(raw.tags)) {
    const labels = (raw.tags as PolymarketTagLike[])
      .map((tag) => asString(tag.label) ?? asString(tag.slug))
      .filter((label): label is string => label !== null && !["sports", "games"].includes(label.toLowerCase()));

    const preferred = labels.find((label) => /nba|nfl|mlb|nhl|mma|ufc|mls|premier league|champions league|laliga|bundesliga|serie a|soccer|football|baseball|basketball|tennis|golf|rugby|cricket/i.test(label));
    if (preferred) return preferred;
    if (labels[0]) return labels[0];
  }

  const [firstSlug] = slugContext.split(/\s+/);
  const code = extractLeagueCodeFromSourceUrl(`https://polymarket.com/event/${firstSlug}`);
  if (code && LEAGUE_PRESENTATION_BY_CODE[code]) {
    return LEAGUE_PRESENTATION_BY_CODE[code].label;
  }

  return "Sports";
}

function inferSport(
  league: string,
  context: {
    eventName: string;
    question: string;
    slugContext: string;
  },
): string {
  const normalizedLeague = normalizeSportLabel(league);
  if (normalizedLeague) return normalizedLeague;

  const slugSport = inferSportFromSlugContext(context.slugContext);
  if (slugSport) return slugSport;

  const participantSport = inferSportFromParticipants(context.eventName);
  if (participantSport) return participantSport;

  const source = `${league} ${context.eventName} ${context.question} ${context.slugContext}`.toLowerCase();
  if (source.includes("nba") || source.includes("basketball")) return "Basketball";
  if (source.includes("nfl") || source.includes("american football")) return "American Football";
  if (source.includes("mlb") || source.includes("baseball")) return "Baseball";
  if (source.includes("nhl") || source.includes("hockey")) return "Hockey";
  if (source.includes("mma") || source.includes("ufc")) return "MMA";
  if (source.includes("rugby")) return "Rugby";
  if (source.includes("tennis")) return "Tennis";
  if (source.includes("golf")) return "Golf";
  if (source.includes("cricket")) return "Cricket";
  if (/(^|[^a-z])(epl|bun|lal|sea|fl1|mls|ucl|fifwc|uefa|serie-a)([^a-z]|$)/.test(source)) return "Soccer";
  if (source.includes("soccer")) return "Soccer";
  if (source.includes("football")) return "Soccer";
  return "Sports";
}

function slugContextFromSourceUrl(sourceUrl: string | null): string {
  if (!sourceUrl) return "";

  try {
    const url = new URL(sourceUrl);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return slug.toLowerCase();
  } catch {
    return sourceUrl.toLowerCase();
  }
}

export function normalizeStoredSport(
  sport: string,
  league: string,
  eventName: string,
  question: string,
  sourceUrl: string | null,
): string {
  if (sport !== "Sports") return sport;

  const inferred = inferSport(league, {
    eventName,
    question,
    slugContext: slugContextFromSourceUrl(sourceUrl),
  });

  return inferred;
}

export function normalizeStoredLeague(
  league: string,
  sourceUrl: string | null,
  sport: string,
): { league: string; leagueLogo: string | null } {
  const code = extractLeagueCodeFromSourceUrl(sourceUrl);

  if (league !== "Sports" && !/^polymarket sports$/i.test(league)) {
    return {
      league,
      leagueLogo: code ? LEAGUE_PRESENTATION_BY_CODE[code]?.logo ?? null : null,
    };
  }

  if (code && LEAGUE_PRESENTATION_BY_CODE[code]) {
    return {
      league: LEAGUE_PRESENTATION_BY_CODE[code].label,
      leagueLogo: LEAGUE_PRESENTATION_BY_CODE[code].logo,
    };
  }

  return {
    league: sport,
    leagueLogo: null,
  };
}

const EVENT_PRESENTATION_TTL_MS = 30 * 60 * 1000;
const eventPresentationCache = new Map<string, { expiresAt: number; value: { startsAt: Date | null; leagueLogo: string | null } }>();
const eventPresentationPromises = new Map<string, Promise<{ startsAt: Date | null; leagueLogo: string | null }>>();

function findBestOfficialTeam(
  teamName: string | null,
  marketLeague: string,
  marketSport: string,
  teams: PolymarketOfficialTeam[],
  excludedIds = new Set<string>(),
): PolymarketOfficialTeam | null {
  let best: { team: PolymarketOfficialTeam; score: number } | null = null;

  for (const team of teams) {
    if (excludedIds.has(team.id)) continue;
    const score = scoreOfficialTeamMatch(teamName, marketLeague, marketSport, team);
    if (score <= 0) continue;

    if (!best || score > best.score) {
      best = { team, score };
    }
  }

  return best?.team ?? null;
}

function getLeagueLogoFallback(
  inputLeagueLogo: string | null,
  metadata: PolymarketOfficialMetadata,
  league: string,
  sport: string,
  sourceUrl: string | null,
): string | null {
  if (inputLeagueLogo) return inputLeagueLogo;

  const code = extractLeagueCodeFromSourceUrl(sourceUrl);
  if (code) {
    const byCode = metadata.sportImageBySlug.get(code.toLowerCase());
    if (byCode) return byCode;
  }

  const normalizedLeague = normalizeComparable(league);
  const normalizedSport = normalizeComparable(sport);
  if (!normalizedLeague || normalizedLeague === "sports" || normalizedLeague === normalizedSport) {
    return metadata.sportImageByLabel.get(sport.toLowerCase()) ?? null;
  }

  return null;
}
// Team badge color palette — deterministic from team name
const TEAM_BADGE_COLORS = [
  "#1a73e8", "#2563eb", "#7c3aed", "#c026d3",
  "#db2777", "#e11d48", "#dc2626", "#ea580c",
  "#ca8a04", "#65a30d", "#059669", "#0d9488",
  "#0891b2", "#0284c7", "#4338ca", "#7e22ce",
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getTeamBadgeColor(name: string): string {
  const code = hashCode(name);
  return TEAM_BADGE_COLORS[code % TEAM_BADGE_COLORS.length];
}

function extractTeamInitials(name: string | null, maxChars = 2): string {
  if (!name) return "?";

  const cleaned = name
    .replace(/^\d+\s+/, "")
    .replace(/\b(?:fc|cf|sc|fk|sk|ec|ca|cd|ud|ac|afc|bc|bk|fbc|club|the|basket|re|de|y|esgrima|saudi|futebol|de\s+futebol|sporting|athletic)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Try to get first letters of significant words
  const words = cleaned.split(" ").filter(w => w.length >= 1);
  if (words.length >= maxChars) {
    return words.slice(0, maxChars).map(w => w[0].toUpperCase()).join("");
  }
  // Use first characters of the name
  return cleaned.substring(0, maxChars).toUpperCase();
}

function generateTeamBadgeUrl(name: string | null, size = 64): string {
  if (!name) return "";

  const initials = extractTeamInitials(name);
  const color = getTeamBadgeColor(name);
  const bgColor = color;
  const radius = size / 2;
  const fontSize = Math.round(size * 0.38);
  const textX = size / 2;
  const textY = size / 2 + fontSize * 0.35;

  // Simple SVG with circle + initials
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${radius}" cy="${radius}" r="${radius}" fill="${bgColor}"/>
  <text x="${textX}" y="${textY}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${fontSize}" fill="white" dominant-baseline="central">${initials}</text>
</svg>`;

  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml,${encoded}`;
}

// Extended alias map: common alternate names → canonical name patterns
const TEAM_NAME_ALIASES: Record<string, string> = {
  // Basketball
  "Virginia Cavaliers": "Cavaliers",
  "Cavaliers": "Cavaliers",
  // NHL
  "Wild": "Minnesota Wild",
  "Avalanche": "Colorado Avalanche",
  "Canadiens": "Montreal Canadiens",
  "Ducks": "Anaheim Ducks",
  "Timberwolves": "Minnesota Timberwolves",
  "Golden Knights": "Vegas Golden Knights",
  "Sabres": "Buffalo Sabres",
  "Spurs": "San Antonio Spurs",
  "Pistons": "Detroit Pistons",
  // Soccer — remove prefix abbreviations for matching
  "CA River Plate": "River Plate",
  "CF Cruz Azul": "Cruz Azul",
  "CD Guadalajara": "Guadalajara",
  "FC Bayern München": "Bayern Munich",
  "FK Dinamo Moskva": "Dinamo Moscow",
  "FK Lokomotiv Moskva": "Lokomotiv Moscow",
  "PFK CSKA Moskva": "CSKA Moscow",
  "CF Montréal": "Montreal",
  "Pumas de la UNAM": "Pumas UNAM",
};

// Lightweight team logo cache: team name → logo URL (persisted across enrich calls)
const teamLogoCache = new Map<string, string>();

// Background scraping state
let backgroundScrapeRunning = false;

/**
 * Background lazy scraper: fetch Polymarket event pages for teams without cached logos,
 * extract team_logos URLs, and populate teamLogoCache.
 * Runs in background (fire-and-forget), does NOT block the response.
 */
async function scrapeLogosFromEventPage(
  sourceUrl: string,
  homeTeam: string | null,
  awayTeam: string | null,
): Promise<void> {
  // Check if we already have these teams cached
  const homeKey = homeTeam?.trim().toLowerCase();
  const awayKey = awayTeam?.trim().toLowerCase();
  const needHome = homeKey && !teamLogoCache.has(homeKey);
  const needAway = awayKey && !teamLogoCache.has(awayKey);
  if (!needHome && !needAway) return;

  try {
    const html = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PWSats/1.0)" },
      signal: AbortSignal.timeout(3_000),
    }).then(r => r.text());

    const logoMatches = html.match(/https:\/\/polymarket-upload[^"]*team_logos[^"]*\.(?:png|jpg|svg)/gi) || [];

    // For each team that needs a logo, try to match against extracted logo filenames
    const teamsNeedingLogos: Array<{ name: string; key: string }> = [];
    if (needHome && homeTeam) teamsNeedingLogos.push({ name: homeTeam, key: homeKey! });
    if (needAway && awayTeam) teamsNeedingLogos.push({ name: awayTeam, key: awayKey! });

    // Group logos by filename pattern
    const logoEntries: Array<{ url: string; abbr1: string; abbr2: string }> = [];
    for (const logoUrl of logoMatches) {
      const filenameMatch = logoUrl.match(/\/([a-z]+)_([a-z]+)_(\d+)\.\w+$/i);
      if (filenameMatch) {
        logoEntries.push({ url: logoUrl, abbr1: filenameMatch[1], abbr2: filenameMatch[2] });
      }
    }

    // Try to match each team against each logo entry
    for (const team of teamsNeedingLogos) {
      const nameLower = team.key;
      // Clean the team name: remove common prefixes and suffixes
      const cleaned = nameLower
        .replace(/\b(?:cf|fc|cd|ca|fk|sk|ec|ud|ac|afc|bc|fbc|sc|bk|re|de|y|esgrima|saudi|futebol|basket|real|de\s+fútbol)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      const words = cleaned.split(" ").filter(w => w.length >= 2);
      // Also build the full name without spaces
      const nameNoSpaces = cleaned.replace(/\s+/g, "");

      for (const entry of logoEntries) {
        const abbr2 = entry.abbr2.toLowerCase();
        let matched = false;

        // Strategy 1: abbr2 is a direct substring of cleaned name or nameNoSpaces
        if (cleaned.includes(abbr2) || nameNoSpaces.includes(abbr2)) {
          matched = true;
        }

        // Strategy 2: First word starts with first 3 chars of abbr2 (e.g., "guadalajara" starts with "gua")
        if (!matched && words.length >= 1) {
          const abbrStart = abbr2.substring(0, 3);
          if (words[0].startsWith(abbrStart)) {
            matched = true;
          }
        }

        // Strategy 3: Build abbreviation from first letters of words, check against abbr2
        // e.g., "cruz azul" → first letters "ca", but abbr2 = "caz" (c + a + z)
        // Check if first letter of each word matches progressively through abbr2
        if (!matched) {
          let abbrIdx = 0;
          for (const word of words) {
            if (abbrIdx < abbr2.length && word[0].toLowerCase() === abbr2[abbrIdx]) {
              abbrIdx++;
            }
          }
          // If we consumed most of the abbreviation, it's a match
          if (abbrIdx >= abbr2.length * 0.6) {
            matched = true;
          }
        }

        // Strategy 4: abbr2 starts with same first 2 letters as first word
        if (!matched && words.length >= 1) {
          const wordStart = words[0].substring(0, 2);
          const abbrStart2 = abbr2.substring(0, 2);
          if (wordStart === abbrStart2) {
            matched = true;
          }
        }

        // Strategy 5: Levenshtein-like — abbr2 chars appear in order across the name
        if (!matched) {
          const allLetters = nameNoSpaces;
          let abbrIdx = 0;
          for (const ch of allLetters) {
            if (ch === abbr2[abbrIdx]) abbrIdx++;
            if (abbrIdx === abbr2.length) break;
          }
          if (abbrIdx >= abbr2.length - 1) {
            matched = true;
          }
        }

        if (matched) {
          teamLogoCache.set(team.key, entry.url);
          break; // Found a match for this team, move to next team
        }
      }
    }
  } catch {
    // Silently fail — next call will retry
  }
}

/**
 * Start background scraping for markets that need team logos.
 * Fire-and-forget: starts scraping a few event pages but does NOT block.
 */
function startBackgroundLogoScrape(markets: PolymarketOfficialPresentationInput[]): void {
  if (backgroundScrapeRunning) return;

  // Find markets without cached logos and with sourceUrl
  const needsScrape = markets.filter(m => {
    const hk = m.homeTeam?.trim().toLowerCase();
    const ak = m.awayTeam?.trim().toLowerCase();
    const needHome = hk && !teamLogoCache.has(hk);
    const needAway = ak && !teamLogoCache.has(ak);
    return (needHome || needAway) && m.sourceUrl;
  });

  if (needsScrape.length === 0) return;

  // Collect unique sourceUrls — scrape all of them with concurrency limit
  const uniqueUrls = new Set(needsScrape.map(m => m.sourceUrl!).filter(Boolean));
  const urlsToScrape = Array.from(uniqueUrls);

  backgroundScrapeRunning = true;

  // Fire-and-forget: no await, runs in background with concurrency limit
  (async () => {
    try {
      const concurrency = 5;
      let idx = 0;
      while (idx < urlsToScrape.length) {
        const batch = urlsToScrape.slice(idx, idx + concurrency);
        idx += concurrency;
        await Promise.all(batch.map(async (url) => {
          const marketsForUrl = needsScrape.filter(m => m.sourceUrl === url);
          const first = marketsForUrl[0];
          await scrapeLogosFromEventPage(url, first.homeTeam, first.awayTeam);
        }));
      }
    } finally {
      backgroundScrapeRunning = false;
    }
  })();
}

export async function enrichPolymarketOfficialPresentation(
  markets: PolymarketOfficialPresentationInput[],
): Promise<PolymarketOfficialPresentation[]> {
  if (markets.length === 0) return [];

  // Start background scraping for uncached logos (fire-and-forget)
  startBackgroundLogoScrape(markets);

  const metadata = await fetchPolymarketOfficialMetadata();

  // Enrich each market — try official metadata first, then cached logos, then SVG fallback
  return markets.map((market) => {
    const usedIds = new Set<string>();

    // Try direct teamId lookup, then fuzzy match, then alias fuzzy match
    const homeTeam =
      (market.homeTeamId ? metadata.teamById.get(market.homeTeamId) ?? null : null) ??
      findBestOfficialTeam(market.homeTeam, market.league, market.sport, metadata.teams, usedIds) ??
      findBestOfficialTeam(resolveTeamAlias(market.homeTeam), market.league, market.sport, metadata.teams, usedIds);
    if (homeTeam) usedIds.add(homeTeam.id);

    const awayTeam =
      (market.awayTeamId ? metadata.teamById.get(market.awayTeamId) ?? null : null) ??
      findBestOfficialTeam(market.awayTeam, market.league, market.sport, metadata.teams, usedIds) ??
      findBestOfficialTeam(resolveTeamAlias(market.awayTeam), market.league, market.sport, metadata.teams, usedIds);

    // Check background scrape cache for logos
    const homeCacheKey = market.homeTeam?.trim().toLowerCase();
    const awayCacheKey = market.awayTeam?.trim().toLowerCase();
    const cachedHomeBadge = homeCacheKey ? teamLogoCache.get(homeCacheKey) ?? null : null;
    const cachedAwayBadge = awayCacheKey ? teamLogoCache.get(awayCacheKey) ?? null : null;

    return {
      homeBadge: homeTeam?.logo ?? cachedHomeBadge ?? generateTeamBadgeUrl(market.homeTeam),
      awayBadge: awayTeam?.logo ?? cachedAwayBadge ?? generateTeamBadgeUrl(market.awayTeam),
      leagueLogo: getLeagueLogoFallback(market.leagueLogo, metadata, market.league, market.sport, market.sourceUrl),
    };
  });
}

function resolveTeamAlias(name: string | null): string | null {
  if (!name) return null;
  return TEAM_NAME_ALIASES[name] ?? null;
}

function extractEventSlugFromSourceUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;

  try {
    return new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    const parts = sourceUrl.split("/").filter(Boolean);
    return parts.at(-1) ?? null;
  }
}

export async function getPolymarketEventPresentationBySourceUrl(
  sourceUrl: string | null,
): Promise<{ startsAt: Date | null; leagueLogo: string | null }> {
  const slug = extractEventSlugFromSourceUrl(sourceUrl);
  if (!slug) return { startsAt: null, leagueLogo: null };

  const cached = eventPresentationCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existingPromise = eventPresentationPromises.get(slug);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const sidecarEvent = await fetchGammaSidecarEventBySlug(slug);
    if (sidecarEvent && typeof sidecarEvent === "object") return sidecarEvent;

    return fetchJson<unknown>(`${GAMMA_API_BASE}/events/slug/${slug}`);
  })()
    .then((item) => {
      const event = item as PolymarketEventLike;
      const startsAt =
        parseExactDateCandidate(asString(event.eventStartTime)) ??
        parseExactDateCandidate(asString(event.gameStartTime)) ??
        parseExactDateCandidate(asString(event.startTime)) ??
        (() => {
          const rawStart = asString(event.startDate);
          if (!rawStart) return null;
          const parsed = new Date(rawStart);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        })();

      const value = {
        startsAt,
        leagueLogo:
          asString(event.icon) ??
          asString(event.image) ??
          asString(event.featuredImage) ??
          null,
      };

      eventPresentationCache.set(slug, {
        expiresAt: Date.now() + EVENT_PRESENTATION_TTL_MS,
        value,
      });

      return value;
    })
    .catch((err) => {
      logger.warn({ err, slug }, "Failed to fetch Polymarket event presentation");
      const value = { startsAt: null, leagueLogo: null };
      eventPresentationCache.set(slug, {
        expiresAt: Date.now() + 5 * 60 * 1000,
        value,
      });
      return value;
    })
    .finally(() => {
      eventPresentationPromises.delete(slug);
    });

  eventPresentationPromises.set(slug, promise);
  return promise;
}

function isClearlyNonSportsMarket(question: string, subtitle: string | null): boolean {
  const source = `${question} ${subtitle ?? ""}`.toLowerCase();
  return /election|legislative|assembly|senate|governor|president|prime minister|party|seats|parliament|congress|vote share|candidate/i.test(source);
}

function normalizeSportsMarketType(raw: PolymarketMarketLike): string | null {
  const marketType = asString(raw.sportsMarketType);
  return marketType ? marketType.toLowerCase().replace(/\s+/g, "_") : null;
}

function inferOutcomeKey(
  rawLabel: string | null,
  question: string,
  matchup: { homeTeam: string; awayTeam: string },
): "home" | "draw" | "away" | null {
  const label = rawLabel ? normalizeComparable(rawLabel) : null;
  const questionText = normalizeComparable(question);
  const home = normalizeComparable(matchup.homeTeam);
  const away = normalizeComparable(matchup.awayTeam);

  if (label && /^(draw|tie)$/.test(label)) return "draw";
  if (label === home) return "home";
  if (label === away) return "away";

  if (/\bdraw\b|\btie\b/.test(questionText)) return "draw";
  if (questionText.includes(home) && !questionText.includes(away)) return "home";
  if (questionText.includes(away) && !questionText.includes(home)) return "away";

  return null;
}

function getOutcomeSortOrder(key: "home" | "draw" | "away"): number {
  if (key === "home") return 0;
  if (key === "draw") return 1;
  return 2;
}

function getGroupKey(eventId: string, startsAt: Date): string {
  return `group:${eventId}:${startsAt.toISOString().slice(0, 10)}`;
}

function getResolvedDirectWinner(
  pairs: Array<{ label: string; price: number | null; winner: boolean | null }>,
): string | null {
  const flaggedWinner = pairs.find((pair) => pair.winner === true);
  if (flaggedWinner) return flaggedWinner.label;

  const pricedWinner = pairs.find((pair) => pair.price !== null && pair.price >= 99);
  return pricedWinner?.label ?? null;
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    lastStatus = res.status;
    if (res.status === 429 && attempt < 2) {
      const retryAfterSeconds = Number(res.headers.get("retry-after") ?? "");
      const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 750 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    throw new Error(`Polymarket HTTP ${res.status} for ${url}`);
  }

  throw new Error(`Polymarket HTTP ${lastStatus ?? "unknown"} for ${url}`);
}

async function fetchSportsMarketBatch(
  tagId: string | null,
  offset: number,
  options: {
    active?: boolean;
    closed?: boolean;
    order?: "volume_24hr" | "volume" | "liquidity" | "start_date" | "end_date" | "closed_time";
    ascending?: boolean;
  },
): Promise<unknown[] | null> {
  const url = new URL(`${GAMMA_API_BASE}/markets`);
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));
  if (tagId) url.searchParams.set("tag_id", tagId);
  if (tagId) url.searchParams.set("related_tags", "true");
  if (options.active !== undefined) url.searchParams.set("active", String(options.active));
  if (options.closed !== undefined) url.searchParams.set("closed", String(options.closed));
  if (options.order) url.searchParams.set("order", options.order);
  if (options.ascending !== undefined) url.searchParams.set("ascending", String(options.ascending));

  const batch = await fetchJson<unknown>(url.toString());
  return Array.isArray(batch) ? batch : null;
}

function parseCommaSeparatedIds(value: unknown): string[] {
  if (typeof value !== "string") return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item))
    .filter((item) => item !== "1" && item !== "100639");
}

let sportsTagIdsCache: string[] | null = null;
let officialMetadataCache:
  | {
      expiresAt: number;
      value: PolymarketOfficialMetadata;
    }
  | null = null;
let officialMetadataPromise: Promise<PolymarketOfficialMetadata> | null = null;
let marketFetchCache:
  | {
      expiresAt: number;
      value: ExternalSportPolyMarket[];
    }
  | null = null;

const OFFICIAL_METADATA_TTL_MS = 6 * 60 * 60 * 1000;
const OFFICIAL_TEAMS_GATEWAY_URL = "https://gateway.polymarket.us/v1/sports/teams";
const TEAM_PAGE_LIMIT = 500;
const TEAM_MAX_PAGES = 15;
const SPORTS_LEAGUES = [
  "lal", "epl", "mls", "bun", "fif", "fifa",
  "nba", "nfl", "nhl", "mlb", "wnba",
  "ucl", "uel",
  "cbb", "cfb", "wcbb",
  "atp", "wta",
  "ufc",
  "sea", "cod", "cs2",
  "lol", "csgo", "valorant", "dota2", "rl", "ow", "starcraft2",
  "crban", "crbtnmlyhkg20", "crafgwi20", "crafpl", "craus",
  "criplcl", "cricpakt20cup", "cricps", "cricss", "cricthunderbolt", "cricwncl",
  "crind", "crnew", "crpak", "crsou", "cru19wc", "cruae",
  "t20", "test", "odi", "wttmen", "wttwom", "wttc",
  "por", "arg", "col", "bra", "bra2", "chl", "bol1", "per1", "par", "ecu", "uri",
  "ligue1", "fr1", "fr2",
  "seriea", "itc", "bkseriea",
  "tur", "rou1", "gr1", "gre1",
  "ned", "ned1",
  "j1100", "j2100",
  "kleague",
  "bl2", "den", "nor", "rus", "sud",
  "mex", "cfl", "ufl", "npb", "kbo",
  "ahl", "khl", "shl",
  "rugby", "urc", "nrl", "superrugby",
  "euroleague", "bbl", "acb", "lba", "bkarg", "bkfr1", "bkjpn", "bkkbl", "bkcba", "kbl",
  "mmua", "pfl", "bellator", "one",
  "pga", "liv", "golf",
  "bbl", "wbbl",
  "challenger", "itf",
  "j1", "j2", "es1", "lmx", "liga", "spl", "csl", "saudi",
  "fl1", "bra", "arg",
].filter((v, i, a) => a.indexOf(v) === i);

function hasExplicitTimeComponent(value: string | null): boolean {
  return value !== null && /t\d{2}:\d{2}|\b\d{1,2}:\d{2}\b/i.test(value);
}

function parseExactDateCandidate(value: string | null): Date | null {
  if (!value || !hasExplicitTimeComponent(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reverse lookup: map a human-readable league label → compact code.
 * Built from LEAGUE_PRESENTATION_BY_CODE at runtime.
 */
function buildLeagueLabelToCode(): Map<string, string> {
  const result = new Map<string, string>();
  for (const [code, info] of Object.entries(LEAGUE_PRESENTATION_BY_CODE)) {
    if (info.label) {
      const key = normalizeComparable(info.label)
        .replace(/\b(?:league|playoffs|women|men)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (key) result.set(key, code.toLowerCase());
    }
  }
  return result;
}

const LEAGUE_LABEL_TO_CODE = buildLeagueLabelToCode();

function normalizeLeagueKey(value: string | null): string {
  const raw = (value ?? "").trim().toLowerCase();

  // If it's a known compact code, use its presentation label as the canonical key
  const presentation = LEAGUE_PRESENTATION_BY_CODE[raw]?.label;
  if (presentation) {
    return normalizeComparable(presentation)
      .replace(/\b(?:league|playoffs|women|men)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // If it looks like a human-readable label, try to resolve to the compact code
  const normalized = normalizeComparable(raw)
    .replace(/\b(?:league|playoffs|women|men)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const code = LEAGUE_LABEL_TO_CODE.get(normalized);
  if (code) return code;

  // Fall back to the normalized form
  return normalized;
}

function inferSportFromGatewayLeagueCode(value: string | null): string | null {
  const code = (value ?? "").toLowerCase().trim();
  if (!code) return null;

  if (["nba", "wnba", "euroleague", "cbb", "bbl", "acb", "lba"].includes(code)) return "Basketball";
  if (["mlb", "npb", "kbo"].includes(code)) return "Baseball";
  if (["nhl", "ahl", "khl", "shl"].includes(code)) return "Hockey";
  if (["nfl", "cfb", "cfl", "ufl"].includes(code)) return "American Football";
  if (["ufc", "mma", "pfl", "bellator", "one"].includes(code)) return "MMA";
  if (["rugby", "urc", "nrl", "superrugby"].includes(code)) return "Rugby";
  if (["atp", "wta", "challenger", "itf"].includes(code)) return "Tennis";
  if (["pga", "liv", "golf"].includes(code)) return "Golf";
  if (
    /^(arg|bl2|bra|bun|den|epl|ere|es1|es2|fl1|fr2|j1|j2|lal|liga|lmx|mex|mls|nor|por|rus|sea|sud|tur|ucl|uefa|saudi|spl|csl)$/.test(code)
  ) {
    return "Soccer";
  }

  return null;
}

function normalizeTeamKey(value: string | null): string {
  return normalizeComparable(value ?? "")
    .replace(/^\d+\s+/, "")
    .replace(/\bmunich\b/g, "munchen")
    .replace(/\bst\b/g, "saint")
    .replace(/\b(?:fc|cf|sc|fk|sk|ec|ca|cd|ud|ac|afc|bc|bk|fbc|club|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamTokenOverlapScore(left: string | null, right: string | null): number {
  const normalizedLeft = normalizeTeamKey(left);
  const normalizedRight = normalizeTeamKey(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 6;

  if (
    normalizedLeft.length >= 5 &&
    normalizedRight.length >= 5 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 5;
  }

  const leftTokens = normalizedLeft.split(" ").filter(Boolean);
  const rightTokens = normalizedRight.split(" ").filter(Boolean);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightTokenSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightTokenSet.has(token));
  const minRatio = overlap.length / Math.min(leftTokens.length, rightTokens.length);
  const maxRatio = overlap.length / Math.max(leftTokens.length, rightTokens.length);

  if (overlap.length >= 2 && minRatio >= 0.75) return 5;
  if (overlap.length >= 2 && maxRatio >= 0.5) return 4;
  if (overlap.length >= 1 && minRatio >= 0.5) return 3;
  return 0;
}

function scoreOfficialTeamMatch(
  teamName: string | null,
  marketLeague: string,
  marketSport: string,
  candidate: PolymarketOfficialTeam,
): number {
  const candidateSport = inferSportFromGatewayLeagueCode(candidate.league);
  if (candidateSport && candidateSport !== marketSport) return 0;

  const nameScore = Math.max(
    teamTokenOverlapScore(teamName, candidate.name),
    teamTokenOverlapScore(teamName, candidate.alias),
    teamTokenOverlapScore(teamName, candidate.abbreviation),
  );
  if (nameScore === 0) return 0;

  // If name match is exact (6) or very strong (5), allow the match even without league confirmation
  if (nameScore >= 5) return nameScore;

  const marketLeagueKey = normalizeLeagueKey(marketLeague);
  const candidateLeagueKey = normalizeLeagueKey(candidate.league);
  const leagueScore = marketLeagueKey && candidateLeagueKey
    ? marketLeagueKey === candidateLeagueKey ||
      marketLeagueKey.includes(candidateLeagueKey) ||
      candidateLeagueKey.includes(marketLeagueKey)
      ? 2
      : 0
    : 0;

  if (marketLeagueKey && candidateLeagueKey && leagueScore === 0) return 0;

  return nameScore + leagueScore;
}

async function fetchPolymarketOfficialMetadata(): Promise<PolymarketOfficialMetadata> {
  const now = Date.now();
  if (officialMetadataCache && officialMetadataCache.expiresAt > now) {
    return officialMetadataCache.value;
  }
  if (officialMetadataPromise) return officialMetadataPromise;

  officialMetadataPromise = (async () => {
    const sportsPromise = (async () => {
      const sidecarSports = await fetchGammaSidecarSports();
      if (sidecarSports) return sidecarSports as unknown;

      return fetchJson<unknown>(`${GAMMA_API_BASE}/sports`);
    })()
      .catch((err) => {
        logger.warn({ err }, "Failed to fetch Polymarket sports metadata");
        return [] as unknown[];
      });

    const teams: PolymarketOfficialTeam[] = [];
    const seenIds = new Set<string>();

    // Helper to push unique teams
    const pushTeams = (items: unknown[]) => {
      for (const item of items) {
        const team = item as PolymarketTeamLike;
        const id = asString(team.id);
        const name = asString(team.name);
        if (!id || !name || seenIds.has(id)) continue;
        seenIds.add(id);
        teams.push({
          id,
          name,
          league: asString(team.league),
          logo: asString(team.logo),
          abbreviation: asString(team.abbreviation),
          alias: asString(team.alias),
        });
      }
    };

    try {
      // Primary: fetch from Gamma API by known sports leagues (fast, targeted)
      const leagueBatches = await Promise.allSettled(
        SPORTS_LEAGUES.map((league) =>
          fetchJson<unknown>(`${GAMMA_API_BASE}/teams?league=${league}&limit=${TEAM_PAGE_LIMIT}`),
        ),
      );

      for (const result of leagueBatches) {
        if (result.status !== "fulfilled") continue;
        const batch = Array.isArray(result.value) ? result.value : [];
        pushTeams(batch);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch teams by league from Polymarket Gamma API");
    }

    // Secondary: Polymarket Gateway (fills gaps with legacy IDs/aliases)
    try {
      const gatewayPayload = await fetchJson<unknown>(OFFICIAL_TEAMS_GATEWAY_URL);
      const gatewayTeams =
        gatewayPayload &&
        typeof gatewayPayload === "object" &&
        Array.isArray((gatewayPayload as { teams?: unknown }).teams)
          ? (gatewayPayload as { teams: unknown[] }).teams
          : [];
      pushTeams(gatewayTeams);
    } catch (err) {
      logger.warn({ err }, "Failed to fetch teams from Polymarket Gateway");
    }

    // Tertiary: Gamma sidecar if still empty
    if (teams.length === 0) {
      try {
        const sidecarTeams = await fetchGammaSidecarTeams();
        if (sidecarTeams) pushTeams(sidecarTeams);
      } catch (err) {
        logger.warn({ err }, "Failed to fetch teams from Gamma sidecar");
      }
    }

    // Final fallback: paginated Gamma /teams
    if (teams.length === 0) {
      const teamPages = Array.from({ length: TEAM_MAX_PAGES }, (_, index) => index);
      const teamResults = await Promise.allSettled(
        teamPages.map((page) =>
          fetchJson<unknown>(`${GAMMA_API_BASE}/teams?limit=${TEAM_PAGE_LIMIT}&offset=${page * TEAM_PAGE_LIMIT}`),
        ),
      );

      for (const result of teamResults) {
        if (result.status !== "fulfilled") {
          logger.warn({ err: result.reason }, "Failed to fetch Polymarket teams page");
          continue;
        }
        const batch = Array.isArray(result.value) ? result.value : [];
        pushTeams(batch);
        if (batch.length < TEAM_PAGE_LIMIT) break;
      }
    }

    const sportsMeta = await sportsPromise;
    const sportImageBySlug = new Map<string, string>();
    const sportImageByLabel = new Map<string, string>();

    if (Array.isArray(sportsMeta)) {
      for (const item of sportsMeta) {
        const meta = item as PolymarketSportMetaLike;
        const image = asString(meta.image);
        if (!image) continue;

        const rawSport = asString(meta.sport);
        const rawSeries = asString(meta.series);
        const normalizedLabel = normalizeSportLabel(rawSport ?? rawSeries) ?? rawSport ?? rawSeries;

        if (rawSport) sportImageBySlug.set(rawSport.toLowerCase(), image);
        if (rawSeries) sportImageBySlug.set(rawSeries.toLowerCase(), image);
        if (normalizedLabel) sportImageByLabel.set(normalizedLabel.toLowerCase(), image);
      }
    }

    const value = {
      teams,
      teamById: new Map(teams.map((team) => [team.id, team])),
      sportImageBySlug,
      sportImageByLabel,
    };

    officialMetadataCache = {
      expiresAt: now + OFFICIAL_METADATA_TTL_MS,
      value,
    };

    return value;
  })()
    .finally(() => {
      officialMetadataPromise = null;
    });

  return officialMetadataPromise;
}

async function getSportsTagIds(): Promise<string[]> {
  if (sportsTagIdsCache) return sportsTagIdsCache;

  if (SPORTS_ROOT_TAG_ID) {
    sportsTagIdsCache = [SPORTS_ROOT_TAG_ID];
    return sportsTagIdsCache;
  }

  try {
    const rootTag = await fetchJson<{ id?: unknown }>(`${GAMMA_API_BASE}/tags/slug/${SPORTS_TAG_SLUG}`);
    const rootTagId = asString(rootTag.id);
    if (rootTagId && rootTagId !== "1" && rootTagId !== "100639") {
      sportsTagIdsCache = [rootTagId];
      return sportsTagIdsCache;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to resolve Polymarket root sports tag id");
  }

  try {
    const sportsMeta = await fetchJson<unknown>(`${GAMMA_API_BASE}/sports`);
    const tagIds = Array.isArray(sportsMeta)
      ? Array.from(
          new Set(
            sportsMeta.flatMap((item) =>
              parseCommaSeparatedIds((item as PolymarketSportMetaLike).tags),
            ),
          ),
        )
      : [];

    if (tagIds.length > 0) {
      sportsTagIdsCache = tagIds;
      return tagIds;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to resolve Polymarket sports metadata tags");
  }

  sportsTagIdsCache = [];
  return [];
}

function normalizeIndividualSportsOutcome(raw: PolymarketMarketLike, sourceRank: number): GroupableSportsOutcome | null {
  const sourceMarketId = asString(raw.id);
  const question = asString(raw.question) ?? asString(raw.title);
  const subtitle = asString(raw.subtitle) ?? asString(raw.description);
  const marketType = normalizeSportsMarketType(raw);
  const yesInfo = getYesInfo(raw);
  const event = getPrimaryEvent(raw);
  const eventTitle = asString(event?.title);
  const startsAt = extractStartsAt(raw, event);

  if (!yesInfo) return null;
  if (!sourceMarketId || !question || !eventTitle || !startsAt || !withinDateWindow(startsAt)) return null;
  if (marketType !== "moneyline") return null;
  if (isClearlyNonSportsMarket(question, subtitle)) return null;
  if (/\s+-\s+more markets$/i.test(eventTitle)) return null;

  const matchup = parseMatchup(eventTitle);
  if (!matchup) return null;

  const outcomeKey = inferOutcomeKey(asString(raw.groupItemTitle), question, matchup);
  if (!outcomeKey) return null;

  const settledAt = yesInfo.resolvedTruth === true
    ? new Date(
        asString(raw.closedTime) ??
          asString(raw.updatedAt) ??
          asString(raw.endDate) ??
          asString(event?.closedTime) ??
          startsAt.toISOString(),
      )
    : null;

  const slugContext = `${asString(raw.slug) ?? ""} ${asString(event?.slug) ?? ""}`;
  const league = inferLeague(raw, slugContext);
  const sport = inferSport(league, { eventName: eventTitle, question, slugContext });
  const eventId = asString(event?.id) ?? slugify(eventTitle);
  const sourceUrl = toAbsolutePolymarketUrl(asString(event?.slug) ?? asString(raw.slug));
  const leaguePresentation = normalizeStoredLeague(league, sourceUrl, sport);
  const homeTeamId = asString(raw.teamAID);
  const awayTeamId = asString(raw.teamBID);

  return {
    sourceMarketId,
    sourceUrl,
    eventId,
    eventName: `${matchup.homeTeam} vs ${matchup.awayTeam}`,
    homeTeam: matchup.homeTeam,
    awayTeam: matchup.awayTeam,
    homeTeamId,
    awayTeamId,
    homeBadge: null,
    awayBadge: null,
    league: leaguePresentation.league,
    leagueLogo: leaguePresentation.leagueLogo,
    sport,
    startsAt,
    question,
    subtitle,
    outcomeKey,
    outcomeLabel: outcomeKey === "home" ? matchup.homeTeam : outcomeKey === "away" ? matchup.awayTeam : "Draw",
    price: yesInfo.yesPrice,
    isWinner: yesInfo.resolvedTruth,
    settledAt,
    sourceRank,
    relevanceVolume: asNumber(event?.volume) ?? asNumber(raw.volume),
    relevanceVolume24hr: asNumber(event?.volume24hr) ?? asNumber(raw.volume24hr),
    relevanceLiquidity: asNumber(event?.liquidity) ?? asNumber(raw.liquidity),
    relevanceCompetitive: asNumber(event?.competitive) ?? asNumber(raw.competitive),
  };
}

function normalizeDirectMoneylineMarket(raw: PolymarketMarketLike, sourceRank: number): DirectSportsMarket | null {
  const sourceMarketId = asString(raw.id);
  const question = asString(raw.question) ?? asString(raw.title);
  const subtitle = asString(raw.subtitle) ?? asString(raw.description);
  const marketType = normalizeSportsMarketType(raw);
  const event = getPrimaryEvent(raw);
  const eventTitle = asString(event?.title) ?? question;
  const startsAt = extractStartsAt(raw, event);
  const tokenPairs = getTokenPairs(raw);

  if (!sourceMarketId || !question || !eventTitle || !startsAt || !withinDateWindow(startsAt)) return null;
  if (marketType !== "moneyline") return null;
  if (isClearlyNonSportsMarket(question, subtitle)) return null;
  if (/\s+-\s+more markets$/i.test(eventTitle)) return null;

  const matchup = parseMatchup(eventTitle);
  if (!matchup) return null;

  const slugContext = `${asString(raw.slug) ?? ""} ${asString(event?.slug) ?? ""}`;
  const league = inferLeague(raw, slugContext);
  const sport = inferSport(league, { eventName: eventTitle, question, slugContext });
  const eventId = asString(event?.id) ?? slugify(eventTitle);
  const groupKey = getGroupKey(eventId, startsAt);
  const sourceUrl = toAbsolutePolymarketUrl(asString(event?.slug) ?? asString(raw.slug));
  const leaguePresentation = normalizeStoredLeague(league, sourceUrl, sport);
  const homeTeamId = asString(raw.teamAID);
  const awayTeamId = asString(raw.teamBID);

  const normalizedOutcomes: ExternalSportPolyOutcome[] = [];
  for (const pair of tokenPairs) {
    const key = inferOutcomeKey(pair.label, question, matchup);
    if (!key) continue;

    normalizedOutcomes.push({
      key,
      label: key === "draw" ? "Draw" : pair.label,
      price: pair.price ?? null,
      poolSats: 0,
      isWinner: pair.winner,
      sourceMarketId,
      sortOrder: getOutcomeSortOrder(key),
    });
  }

  normalizedOutcomes.sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

  const outcomeKeys = new Set(normalizedOutcomes.map((outcome) => outcome.key));
  if (!outcomeKeys.has("home") || !outcomeKeys.has("away") || outcomeKeys.size < 2 || outcomeKeys.size > 3) return null;

  const resolvedWinnerLabel = getResolvedDirectWinner(tokenPairs);
  if (resolvedWinnerLabel) {
    const winningKey = inferOutcomeKey(resolvedWinnerLabel, question, matchup);
    for (const outcome of normalizedOutcomes) {
      outcome.isWinner = winningKey ? outcome.key === winningKey : outcome.isWinner;
    }
  }

  const winner = normalizedOutcomes.find((outcome) => outcome.isWinner === true) ?? null;
  const settledAt = winner
    ? new Date(
        asString(raw.closedTime) ??
          asString(raw.updatedAt) ??
          asString(raw.endDate) ??
          asString(event?.closedTime) ??
          startsAt.toISOString(),
      )
    : null;

  return {
    groupKey,
    market: {
      externalMarketId: groupKey,
      provider: "polymarket",
      eventName: `${matchup.homeTeam} vs ${matchup.awayTeam}`,
      homeTeam: matchup.homeTeam,
      awayTeam: matchup.awayTeam,
      homeTeamId,
      awayTeamId,
      homeBadge: null,
      awayBadge: null,
      leagueLogo: leaguePresentation.leagueLogo,
      league: leaguePresentation.league,
      sport,
      startsAt,
      question: `Who will win ${matchup.homeTeam} vs ${matchup.awayTeam}?`,
      subtitle,
      sourceUrl,
      status: winner ? "settled" : "open",
      winningOutcome: winner?.key ?? null,
      resolvedValue: winner?.label ?? null,
      settledAt,
      outcomes: normalizedOutcomes,
      relevanceRank: sourceRank,
    },
  };
}

function getGroupedMarketRelevance(items: GroupableSportsOutcome[]): {
  volume: number;
  volume24hr: number;
  liquidity: number;
  competitive: number;
  sourceRank: number;
  startsAt: number;
} {
  return items.reduce((best, item) => ({
    volume: Math.max(best.volume, item.relevanceVolume ?? 0),
    volume24hr: Math.max(best.volume24hr, item.relevanceVolume24hr ?? 0),
    liquidity: Math.max(best.liquidity, item.relevanceLiquidity ?? 0),
    competitive: Math.max(best.competitive, item.relevanceCompetitive ?? 0),
    sourceRank: Math.min(best.sourceRank, item.sourceRank),
    startsAt: Math.min(best.startsAt, item.startsAt.getTime()),
  }), {
    volume: 0,
    volume24hr: 0,
    liquidity: 0,
    competitive: 0,
    sourceRank: Number.POSITIVE_INFINITY,
    startsAt: Number.POSITIVE_INFINITY,
  });
}

function compareGroupedSportsMarketRelevance(a: GroupableSportsOutcome[], b: GroupableSportsOutcome[]): number {
  const left = getGroupedMarketRelevance(a);
  const right = getGroupedMarketRelevance(b);

  if (left.volume !== right.volume) return right.volume - left.volume;
  if (left.volume24hr !== right.volume24hr) return right.volume24hr - left.volume24hr;
  if (left.liquidity !== right.liquidity) return right.liquidity - left.liquidity;
  if (left.competitive !== right.competitive) return right.competitive - left.competitive;
  if (left.sourceRank !== right.sourceRank) return left.sourceRank - right.sourceRank;
  if (left.startsAt !== right.startsAt) return left.startsAt - right.startsAt;

  return (a[0]?.eventName ?? "").localeCompare(b[0]?.eventName ?? "");
}

function toGroupedSportsMarket(items: GroupableSportsOutcome[], relevanceRank: number): ExternalSportPolyMarket {
  const first = items[0];
  const sorted = [...items].sort((left, right) => {
    const orderDiff = getOutcomeSortOrder(left.outcomeKey) - getOutcomeSortOrder(right.outcomeKey);
    if (orderDiff !== 0) return orderDiff;
    return left.sourceRank - right.sourceRank;
  });

  const outcomes = sorted.map((item) => ({
    key: item.outcomeKey,
    label: item.outcomeLabel,
    price: item.price ?? null,
    poolSats: 0,
    isWinner: item.isWinner,
    sourceMarketId: item.sourceMarketId,
    sortOrder: getOutcomeSortOrder(item.outcomeKey),
  }));

  const winner = outcomes.find((outcome) => outcome.isWinner === true) ?? null;
  const winningItem = winner
    ? sorted.find((item) => item.outcomeKey === winner.key)
    : null;

  return {
    externalMarketId: getGroupKey(first.eventId, first.startsAt),
    provider: "polymarket",
    eventName: first.eventName,
    homeTeam: first.homeTeam,
    awayTeam: first.awayTeam,
    homeTeamId: first.homeTeamId,
    awayTeamId: first.awayTeamId,
    homeBadge: first.homeBadge,
    awayBadge: first.awayBadge,
    leagueLogo: first.leagueLogo,
    league: first.league,
    sport: first.sport,
    startsAt: first.startsAt,
    question: `Who will win ${first.eventName}?`,
    subtitle: first.subtitle,
    sourceUrl: first.sourceUrl,
    status: winner ? "settled" : "open",
    winningOutcome: winner?.key ?? null,
    resolvedValue: winner?.label ?? null,
    settledAt: winningItem?.settledAt ?? null,
    outcomes,
    relevanceRank,
  };
}

function hasSupportedMatchOutcomes(items: GroupableSportsOutcome[]): boolean {
  const keys = new Set(items.map((item) => item.outcomeKey));
  return keys.has("home") && keys.has("away") && keys.size >= 2 && keys.size <= 3;
}

export async function fetchPolymarketSportsMarkets(): Promise<ExternalSportPolyMarket[]> {
  if (marketFetchCache && marketFetchCache.expiresAt > Date.now()) {
    return marketFetchCache.value;
  }

  const tagIds = await getSportsTagIds();
  const grouped = new Map<string, GroupableSportsOutcome[]>();
  const direct = new Map<string, ExternalSportPolyMarket>();
  const seenSourceMarketIds = new Set<string>();
  let sourceRank = 0;

  const collectBatch = (batch: unknown[]) => {
    for (const item of batch) {
      const raw = item as PolymarketMarketLike;
      const market = normalizeIndividualSportsOutcome(raw, sourceRank);
      const directMarket = market ? null : normalizeDirectMoneylineMarket(raw, sourceRank);
      sourceRank += 1;
      if (market) {
        if (seenSourceMarketIds.has(market.sourceMarketId)) continue;
        seenSourceMarketIds.add(market.sourceMarketId);

        const key = getGroupKey(market.eventId, market.startsAt);
        const list = grouped.get(key) ?? [];

        if (list.some((existing) => existing.outcomeKey === market.outcomeKey)) {
          const existingIndex = list.findIndex((existing) => existing.outcomeKey === market.outcomeKey);
          if (existingIndex >= 0 && list[existingIndex]!.sourceRank <= market.sourceRank) {
            grouped.set(key, list);
            continue;
          }
          if (existingIndex >= 0) list.splice(existingIndex, 1);
        }

        list.push(market);
        grouped.set(key, list);
        continue;
      }

      if (!directMarket) continue;
      if (direct.has(directMarket.groupKey)) continue;
      direct.set(directMarket.groupKey, directMarket.market);
    }
  };

  const scopedTagIds = tagIds.length > 0 ? tagIds : [null];

  for (const tagId of scopedTagIds) {
    for (let page = 0; page < MAX_ACTIVE_PAGES; page += 1) {
      const offset = page * PAGE_LIMIT;
      let batch: unknown[] | null;

      try {
        batch = await fetchSportsMarketBatch(tagId, offset, {
          active: true,
          closed: false,
          order: "end_date",
          ascending: true,
        });
      } catch (err) {
        logger.warn({ err, page, tagId }, "Failed to fetch active Polymarket sports markets");
        break;
      }

      if (!batch || batch.length === 0) break;
      collectBatch(batch);
      if (batch.length < PAGE_LIMIT) break;
    }
  }

  for (const tagId of scopedTagIds) {
    for (let page = 0; page < MAX_CLOSED_PAGES; page += 1) {
      const offset = page * PAGE_LIMIT;
      let batch: unknown[] | null;

      try {
        batch = await fetchSportsMarketBatch(tagId, offset, {
          closed: true,
          order: "volume",
          ascending: false,
        });
      } catch (err) {
        logger.warn({ err, page, tagId }, "Failed to fetch closed Polymarket sports markets");
        break;
      }

      if (!batch || batch.length === 0) break;
      collectBatch(batch);
      if (batch.length < PAGE_LIMIT) break;
    }
  }

  const groupedMarkets = Array.from(grouped.values())
    .filter(hasSupportedMatchOutcomes)
    .sort(compareGroupedSportsMarketRelevance)
    .map((items, index) => toGroupedSportsMarket(items, index));

  const groupedKeys = new Set(groupedMarkets.map((market) => market.externalMarketId));
  const directMarkets = Array.from(direct.values())
    .filter((market) => !groupedKeys.has(market.externalMarketId))
    .sort((left, right) => {
      const leftRank = left.relevanceRank ?? Number.POSITIVE_INFINITY;
      const rightRank = right.relevanceRank ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.startsAt.getTime() - right.startsAt.getTime();
    })
    .map((market, index) => ({ ...market, relevanceRank: groupedMarkets.length + index }));

  const markets = [...groupedMarkets, ...directMarkets];
  if (markets.length > 0) {
    marketFetchCache = {
      expiresAt: Date.now() + MARKET_FETCH_CACHE_TTL_MS,
      value: markets,
    };
    return markets;
  }

  if (marketFetchCache) {
    logger.warn("Using cached Polymarket sports markets after empty upstream result");
    return marketFetchCache.value;
  }

  return markets;
}
