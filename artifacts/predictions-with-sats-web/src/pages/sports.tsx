import { useState, useEffect, useRef, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Trophy, Clock, CheckCircle2, AlertCircle,
  Copy, Zap, ShieldCheck, ChevronDown, ChevronUp, XCircle,
  BookOpen, Wallet, Handshake, Coins, Award, ListChecks,
  X, Share2, Gift, Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import {
  saveSportBetHashForKey,
  getSportBetHashesForKey,
  migrateLegacySportsBetHashes,
  removeSportBetHashForKey,
} from "@/components/my-bet-widget";
import { GuidePager, type GuideStep } from "@/components/guide-pager";
import { ErrorState, LoadingState } from "@/components/query-state";
import { getCurrentStakePayout, getPoolMultiple, getProjectedPayout } from "@/lib/payout-preview";

// ---------------------------------------------------------------------------
// Polymarket → SportEvent adapter
// ---------------------------------------------------------------------------

interface PolyOutcome {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
}

interface PolyMarket {
  id: number;
  provider: string;
  eventName: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  league: string;
  sport: string;
  startsAt: string;
  question: string;
  subtitle: string | null;
  sourceUrl: string | null;
  status: "open" | "settled";
  outcome: string | null;
  resolvedValue: string | null;
  settledAt: string | null;
  outcomes: PolyOutcome[];
}

function polyToSportEvent(m: PolyMarket): SportEvent {
  const homeOutcome = m.outcomes.find(o => o.key === "home");
  const awayOutcome = m.outcomes.find(o => o.key === "away");
  const drawOutcome = m.outcomes.find(o => o.key === "draw");

  const rawOutcome = m.outcome ?? null;
  let outcome: "home" | "draw" | "away" | null = null;
  if (rawOutcome === "home") outcome = "home";
  else if (rawOutcome === "away") outcome = "away";
  else if (rawOutcome === "draw") outcome = "draw";

  const isSettled = m.status === "settled";

  return {
    id: String(m.id),
    event: m.eventName,
    homeTeam: m.homeTeam ?? "",
    awayTeam: m.awayTeam ?? "",
    homeBadge: m.homeBadge,
    awayBadge: m.awayBadge,
    leagueLogo: m.leagueLogo,
    leagueId: null,
    league: m.league,
    sport: m.sport,
    startsAt: m.startsAt,
    status: isSettled ? "finished" : "upcoming",
    elapsed: null,
    homeScore: null,
    awayScore: null,
    outcome,
    marketId: m.id,
    totalHomeSats: homeOutcome?.poolSats ?? 0,
    totalDrawSats: drawOutcome?.poolSats ?? 0,
    totalAwaySats: awayOutcome?.poolSats ?? 0,
    marketStatus: m.status,
    marketOutcome: m.outcome,
    marketFinishedAt: m.settledAt,
    marketSettledAt: m.settledAt,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "home" | "draw" | "away";
type SportKey = "football" | "nba" | "nfl" | "mlb" | "mma" | "rugby" | "hockey" | "basketball";
type ContentTab = "guide" | "upcoming" | "results" | "myBets";
type MarketDateOption = {
  value: string;
  label: string;
  sortKey: number;
  count: number;
};

interface SportDef {
  key: SportKey;
  label: string;
  icon: string;
  sportName: string;        // matches SportEvent.sport from API
  hasDraw: boolean;         // basketball/nfl have no draws
  cardClass: string;        // upcoming card bg + border
  resultCardClass: string;  // finished card bg + border
  eventIdPrefix?: string;   // when set, filter events by id prefix instead of sportName
}

const SPORTS: SportDef[] = [
  {
    key: "football",
    label: "Football",
    icon: "⚽",
    sportName: "Soccer",
    hasDraw: true,
    cardClass: "surface-tint-green",
    resultCardClass: "surface-tint-green-soft",
  },
  {
    key: "nfl",
    label: "NFL",
    icon: "🏈",
    sportName: "American Football",
    hasDraw: false,
    cardClass: "surface-tint-indigo",
    resultCardClass: "surface-tint-indigo-soft",
  },
  {
    key: "mlb",
    label: "Baseball",
    icon: "⚾",
    sportName: "Baseball",
    hasDraw: false,
    cardClass: "surface-tint-red",
    resultCardClass: "surface-tint-red-soft",
  },
  {
    key: "mma",
    label: "MMA",
    icon: "🥊",
    sportName: "MMA",
    hasDraw: false,
    cardClass: "surface-tint-yellow",
    resultCardClass: "surface-tint-yellow-soft",
  },
  {
    key: "rugby",
    label: "Rugby",
    icon: "🏉",
    sportName: "Rugby",
    hasDraw: true,
    cardClass: "surface-tint-emerald",
    resultCardClass: "surface-tint-emerald-soft",
  },
  {
    key: "hockey",
    label: "Hockey",
    icon: "🏒",
    sportName: "Hockey",
    hasDraw: false,
    cardClass: "surface-tint-blue",
    resultCardClass: "surface-tint-blue",
  },
  {
    key: "basketball",
    label: "Basketball",
    icon: "🏀",
    sportName: "Basketball",
    hasDraw: false,
    cardClass: "surface-tint-purple",
    resultCardClass: "surface-tint-purple-soft",
  },
];

// ---------------------------------------------------------------------------
// Category definitions (groups SportDefs into a two-level hierarchy)
// ---------------------------------------------------------------------------

interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  sports: SportKey[];
  showSubcategories?: boolean;
}

const CATEGORIES: CategoryDef[] = [
  { key: "football",          label: "Football",          icon: "⚽", sports: ["football"] },
  { key: "baseball",          label: "Baseball",          icon: "⚾", sports: ["mlb"] },
  { key: "basketball",        label: "Basketball",        icon: "🏀", sports: ["basketball"] },
  { key: "mma",               label: "MMA",               icon: "🥊", sports: ["mma"] },
  { key: "rugby",             label: "Rugby",             icon: "🏉", sports: ["rugby"] },
  { key: "american-football", label: "American Football", icon: "🏈", sports: ["nfl"],          showSubcategories: true },
  { key: "hockey",            label: "Hockey",            icon: "🏒", sports: ["hockey"] },
];

interface SportEvent {
  id: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeBadge: string | null;
  awayBadge: string | null;
  leagueLogo: string | null;
  leagueId?: number | null;
  league: string;
  sport: string;
  startsAt: string;
  status: "upcoming" | "finished" | "live";
  elapsed?: number | null;
  homeScore: number | null;
  awayScore: number | null;
  outcome: "home" | "draw" | "away" | null;
  marketId: number | null;
  totalHomeSats: number;
  totalDrawSats: number;
  totalAwaySats: number;
  marketStatus: string | null;
  marketOutcome: string | null;
  marketFinishedAt: string | null;
  marketSettledAt: string | null;
}

interface SportBetStatus {
  id: number;
  paymentHash: string;
  direction: string;
  amountSats: number;
  status: string;
  payoutSats: number | null;
  marketId: number | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  market: {
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    status: string;
    outcome: string | null;
    finishedAt: string | null;
  } | null;
}

declare global {
  interface Window {
    webln?: {
      enable: () => Promise<void>;
      sendPayment: (pr: string) => Promise<{ preimage: string }>;
    };
  }
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MIN_SATS = 546;
const BTC_SATS = 100_000_000;
const APPROX_BTC_USD = 95000;
const REFRESH_INTERVAL_MS = 3_000;
const EVENT_IMMINENT_MS = 5 * 60 * 1000;
const EVENT_IMMINENT_BRIDGE_MS = 4 * 60 * 60 * 1000;

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function formatSats(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatReturnPercent(roiPercent: number | null) {
  if (roiPercent === null) return "New side";
  return `${roiPercent >= 0 ? "+" : ""}${roiPercent.toFixed(0)}% if win`;
}

const SHOW_PROJECTED_PAYOUT_UI = false;

function isDirection(value: string): value is Direction {
  return value === "home" || value === "draw" || value === "away";
}

function formatKickoff(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function msTillKickoff(isoStr: string) {
  return new Date(isoStr).getTime() - Date.now();
}

function isEventImminent(isoStr: string, now = Date.now()) {
  const diff = new Date(isoStr).getTime() - now;
  return diff > 0 && diff < EVENT_IMMINENT_MS;
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getEventDateOption(isoStr: string): MarketDateOption {
  const date = new Date(isoStr);
  const value = getLocalDateKey(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const optionDate = new Date(date);
  optionDate.setHours(0, 0, 0, 0);

  let label: string;
  if (optionDate.getTime() === today.getTime()) {
    label = "Today";
  } else if (optionDate.getTime() === tomorrow.getTime()) {
    label = "Tomorrow";
  } else {
    label = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return { value, label, sortKey: optionDate.getTime(), count: 0 };
}

const DIRECTION_LABELS: Record<Direction, string> = {
  home: "HOME",
  draw: "DRAW",
  away: "AWAY",
};

const DIRECTION_COLORS: Record<Direction, { btn: string; text: string; cta: string }> = {
  home: { btn: "bg-green-500/10 text-green-400 border border-green-500/40 hover:bg-green-500/20 hover:border-green-500", text: "text-green-400", cta: "bg-green-600 hover:bg-green-700 text-white" },
  draw: { btn: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/40 hover:bg-yellow-500/20 hover:border-yellow-500", text: "text-yellow-400", cta: "bg-yellow-500 hover:bg-yellow-600 text-black" },
  away: { btn: "bg-blue-500/10 text-blue-400 border border-blue-500/40 hover:bg-blue-500/20 hover:border-blue-500", text: "text-blue-400", cta: "bg-blue-600 hover:bg-blue-700 text-white" },
};

const LEAGUE_PRIORITY: Partial<Record<SportKey, readonly string[]>> = {
  football: [
    "2",   // UEFA Champions League
    "3",   // UEFA Europa League
    "848", // UEFA Europa Conference League
    "39",  // Premier League
    "40",  // Championship
    "140", // La Liga
    "78",  // Bundesliga
    "135", // Serie A (Italy)
    "61",  // Ligue 1
    "94",  // Primeira Liga
    "13",  // CONMEBOL Libertadores
    "71",  // Brasileirao Serie A
    "262", // Liga MX
    "253", // MLS
    "128", // Argentina LPF
    "88",  // Eredivisie
    "203", // Super Lig
    "144", // Jupiler Pro League
    "307", // Saudi Pro League
    "292", // K League 1
  ],
  nba: ["NBA Playoffs", "NBA"],
  nfl: ["NFL Playoffs", "NFL"],
  mlb: ["MLB Playoffs", "MLB", "LMB", "KBO", "NPB", "CPBL", "Liga Venezolana", "Liga Colombiana"],
  mma: ["UFC", "PFL", "Bellator", "ONE Championship", "MMA"],
  rugby: ["Six Nations", "Rugby Championship", "Premiership", "Top 14", "United Rugby Championship", "Super Rugby", "Rugby"],
  basketball: ["NBA Playoffs", "NBA", "EuroLeague", "ACB", "Liga A", "BSN", "NBB", "LNB", "Liga Nacional"],
};

const FOOTBALL_LEAGUE_LABELS: Record<string, string> = {
  "2": "UEFA Champions League",
  "3": "UEFA Europa League",
  "848": "UEFA Europa Conference League",
  "39": "Premier League",
  "40": "Championship",
  "140": "La Liga",
  "78": "Bundesliga",
  "135": "Serie A",
  "61": "Ligue 1",
  "94": "Primeira Liga",
  "13": "CONMEBOL Libertadores",
  "71": "Brasileirao Serie A",
  "262": "Liga MX",
  "253": "Major League Soccer",
  "128": "Liga Profesional Argentina",
  "88": "Eredivisie",
  "203": "Super Lig",
  "144": "Jupiler Pro League",
  "307": "Saudi Pro League",
  "292": "K League 1",
};

type LeagueOption = {
  value: string;
  label: string;
  sortKey: string;
};

function getLeagueOption(ev: SportEvent, sport: SportKey): LeagueOption {
  const leagueId = ev.leagueId != null ? String(ev.leagueId) : null;
  if (sport === "football" && leagueId) {
    return {
      value: leagueId,
      label: FOOTBALL_LEAGUE_LABELS[leagueId] ?? ev.league,
      sortKey: leagueId,
    };
  }

  return {
    value: ev.league,
    label: ev.league,
    sortKey: ev.league,
  };
}

// ---------------------------------------------------------------------------
// Team badge
// ---------------------------------------------------------------------------

function TeamBadge({ src, name, size = "sm" }: { src: string | null; name: string; size?: "sm" | "lg" }) {
  const [error, setError] = useState(false);
  const dim = size === "lg" ? "w-12 h-12" : "w-8 h-8";
  const txt = size === "lg" ? "text-sm" : "text-[10px]";
  if (!src || error) {
    return (
      <div className={`${dim} rounded-full bg-muted flex items-center justify-center ${txt} font-bold text-muted-foreground shrink-0`}>
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className={`${dim} object-contain shrink-0`}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth === 0 || img.naturalHeight === 0) setError(true);
      }}
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Three-way pool bar
// ---------------------------------------------------------------------------

function PoolBar({ homeSats, drawSats, awaySats, hasDraw = true }: { homeSats: number; drawSats: number; awaySats: number; hasDraw?: boolean }) {
  const total = homeSats + drawSats + awaySats;
  const defaultShare = hasDraw ? 100 / 3 : 50;
  const pH = total > 0 ? (homeSats / total) * 100 : defaultShare;
  const pD = total > 0 ? (drawSats / total) * 100 : (hasDraw ? defaultShare : 0);
  const pA = total > 0 ? (awaySats / total) * 100 : defaultShare;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center font-mono text-xs mb-1">
        <span className="font-bold text-green-500">{pH.toFixed(1)}% HOME</span>
        <span className="text-[10px] text-muted-foreground">Pool: {formatSats(total)} sats</span>
        <span className="font-bold text-blue-500">{pA.toFixed(1)}% AWAY</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        <div className="bg-green-500 transition-all" style={{ width: `${pH}%` }} />
        {hasDraw && <div className="bg-yellow-400 transition-all" style={{ width: `${pD}%` }} />}
        <div className="bg-blue-500 transition-all" style={{ width: `${pA}%` }} />
      </div>
      {hasDraw && (
        <div className="text-center text-[10px] font-mono font-bold text-yellow-400">
          {pD.toFixed(1)}% DRAW
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Football Guide
// ---------------------------------------------------------------------------

const FOOTBALL_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "How Sports Predictions Work",
    body: "Choose an upcoming football match and predict the outcome: HOME win, DRAW, or AWAY win. Pay your bet via the Lightning Network (no account needed). Winners split the entire pool minus a 2% house fee.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "After picking a side, scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Handshake,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Three Outcomes — All Real",
    body: "Unlike some platforms, DRAW is a fully supported outcome. If the match ends in a draw, only bettors who picked DRAW collect. No partial refunds — every bet counts.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a match flow into one shared pool. After the final whistle, winners split the total pool proportional to their stake (minus 2% fee). Payout arrives via Lightning — scan the withdrawal QR to claim your sats.",
  },
  {
    icon: Award,
    color: "text-orange-400",
    iconBg: "bg-orange-400/15 border-orange-400/40",
    cardTint: "bg-orange-400/5",
    cardBorder: "border-orange-400/30",
    title: "Automatic Settlement",
    body: "Our system checks match results every 5 minutes. Once a result is confirmed, payouts are calculated and withdrawal QR codes are generated automatically. No manual action needed.",
  },
  {
    icon: ListChecks,
    color: "text-red-400",
    iconBg: "bg-red-400/15 border-red-400/40",
    cardTint: "bg-red-400/5",
    cardBorder: "border-red-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before kick-off.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your preimage (payment proof) — you can verify your bet manually if needed.\n• Odds are implied by the pool: bet early for better value.",
  },
];

function FootballGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={FOOTBALL_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">⚽</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Football Betting Guide</h2>
        </>
      }
      ctaClass="bg-green-400/10 border-green-400/30 text-green-400 hover:bg-green-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// NBA Guide
// ---------------------------------------------------------------------------

const NBA_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-orange-400",
    iconBg: "bg-orange-400/15 border-orange-400/40",
    cardTint: "bg-orange-400/5",
    cardBorder: "border-orange-400/30",
    title: "How NBA Predictions Work",
    body: "Pick an upcoming NBA game and predict the winner: HOME team or AWAY team. Basketball has no draws — overtime is played until a winner is decided. Pay via Lightning, winners split the pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a game flow into one shared pool. After the final buzzer, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks game results every 15 minutes. Once the final score is confirmed, payouts are calculated and withdrawal QR codes are generated automatically.",
  },
  {
    icon: ListChecks,
    color: "text-red-400",
    iconBg: "bg-red-400/15 border-red-400/40",
    cardTint: "bg-red-400/5",
    cardBorder: "border-red-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before tip-off.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your payment proof — you can verify your bet manually.\n• Bet early for better value when the pool is thin.",
  },
];

function NBAGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={NBA_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">🏀</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">NBA Betting Guide</h2>
        </>
      }
      ctaClass="bg-orange-400/10 border-orange-400/30 text-orange-400 hover:bg-orange-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// NFL Guide
// ---------------------------------------------------------------------------

const NFL_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-indigo-400",
    iconBg: "bg-indigo-400/15 border-indigo-400/40",
    cardTint: "bg-indigo-400/5",
    cardBorder: "border-indigo-400/30",
    title: "How NFL Predictions Work",
    body: "Pick an upcoming NFL game and predict the winner: HOME team or AWAY team. American football has no draws — overtime is always played until a winner is decided. Pay via Lightning, winners split the entire pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a game flow into one shared pool. After the final whistle, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks game results regularly. Once the final score is confirmed, payouts are calculated and withdrawal QR codes are generated automatically. NFL games can run up to 4 hours with overtime.",
  },
  {
    icon: ListChecks,
    color: "text-red-400",
    iconBg: "bg-red-400/15 border-red-400/40",
    cardTint: "bg-red-400/5",
    cardBorder: "border-red-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before kickoff.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your payment proof — you can verify your bet manually.\n• NFL season runs September to February. Off-season: no games available.\n• Bet early for better value when the pool is thin.",
  },
];

function NFLGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={NFL_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">🏈</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">NFL Betting Guide</h2>
        </>
      }
      ctaClass="bg-indigo-400/10 border-indigo-400/30 text-indigo-400 hover:bg-indigo-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// MLB Guide
// ---------------------------------------------------------------------------

const MLB_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-red-400",
    iconBg: "bg-red-400/15 border-red-400/40",
    cardTint: "bg-red-400/5",
    cardBorder: "border-red-400/30",
    title: "How Baseball Predictions Work",
    body: "Pick an upcoming baseball game and predict the winner: HOME team or AWAY team. Baseball has no draws — extra innings are played until a winner is decided. Pay via Lightning, winners split the entire pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a game flow into one shared pool. After the final out, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks game results every hour. Once the final score is confirmed, payouts are calculated and withdrawal QR codes are generated automatically. Games with extra innings can run up to 5 hours.",
  },
  {
    icon: ListChecks,
    color: "text-red-400",
    iconBg: "bg-red-400/15 border-red-400/40",
    cardTint: "bg-red-400/5",
    cardBorder: "border-red-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before first pitch.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your payment proof — you can verify your bet manually.\n• Baseball season runs April through November across MLB, LMB, and other leagues.\n• Bet early for better value when the pool is thin.",
  },
];

function MLBGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={MLB_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">⚾</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Baseball Betting Guide</h2>
        </>
      }
      ctaClass="bg-red-400/10 border-red-400/30 text-red-400 hover:bg-red-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// MMA Guide
// ---------------------------------------------------------------------------

const MMA_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "How MMA Predictions Work",
    body: "Pick an upcoming UFC, Bellator, ONE Championship or PFL fight and predict the winner: Fighter 1 (HOME) or Fighter 2 (AWAY). MMA has no draws in our system — every fight has a winner. Pay via Lightning, winners split the entire pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a fight flow into one shared pool. After the final bell, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code — no account needed.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks fight results every 30 minutes. Once the official decision is confirmed — KO, TKO, submission or judges' decision — payouts are calculated automatically. Full UFC events including prelims can run up to 6 hours.",
  },
  {
    icon: ListChecks,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before the fight starts.\n• Individual fights are listed — you can bet on any fight on the card, not just the main event.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• MMA events happen year-round every weekend.\n• Bet early for better value when the pool is thin.",
  },
];

function MMAGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={MMA_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">🥊</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">MMA Betting Guide</h2>
        </>
      }
      ctaClass="bg-yellow-400/10 border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// Rugby Guide
// ---------------------------------------------------------------------------

const RUGBY_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "How Rugby Predictions Work",
    body: "Pick an upcoming rugby match across Six Nations, Rugby Championship, Premiership, Top 14, URC, Super Rugby and more. Predict HOME win, AWAY win or DRAW. In regular season, matches can end in a draw — so DRAW is a valid bet. Pay via Lightning, winners split the entire pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a match flow into one shared pool split across HOME, DRAW and AWAY. After the final whistle, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks match results every hour. Once the final score is confirmed, payouts are calculated and withdrawal QR codes appear automatically. Rugby matches run ~80 minutes plus stoppage time. Knockout matches with extra time can last up to 2.5 hours.",
  },
  {
    icon: ListChecks,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before kick-off.\n• Both hemispheres covered — Northern (Six Nations, Premiership, Top 14) and Southern (Super Rugby, Rugby Championship).\n• DRAW is a real outcome in regular-season pool games — bet wisely!\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Rugby runs year-round with events almost every weekend.",
  },
];

function RugbyGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={RUGBY_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">🏉</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Rugby Betting Guide</h2>
        </>
      }
      ctaClass="bg-emerald-400/10 border-emerald-400/30 text-emerald-400 hover:bg-emerald-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// Basketball (International) Guide
// ---------------------------------------------------------------------------

const BASKETBALL_GUIDE_STEPS: GuideStep[] = [
  {
    icon: BookOpen,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "How Basketball Predictions Work",
    body: "Pick an upcoming basketball game — Liga A, BSN, EuroLeague and more — and predict the winner: HOME team or AWAY team. Basketball has no draws: overtime is always played until a winner is decided. Pay via Lightning, winners split the pool.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is $0.50 USD.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a game flow into one shared pool. After the final buzzer, winners split the total pool proportional to their stake (minus 2% house fee). Claim your sats via the withdrawal QR code — no account needed.",
  },
  {
    icon: Award,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Automatic Settlement",
    body: "Our system checks game results every 15 minutes. Once the final score is confirmed, payouts are calculated and withdrawal QR codes are generated automatically. Games including overtime run up to 3.5 hours.",
  },
  {
    icon: ListChecks,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before tip-off.\n• Covers international leagues: Argentina Liga A, Puerto Rico BSN, EuroLeague, ACB, and many more.\n• NBA games are listed under the NBA tab.\n• If no opposing bets are placed, your stake returns as REFUND minus a 0.5% refund fee.\n• Bet early for better value when the pool is thin.",
  },
];

function BasketballGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <GuidePager
      steps={BASKETBALL_GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <span className="text-2xl leading-none">🏀</span>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Basquete Betting Guide</h2>
        </>
      }
      ctaClass="bg-purple-400/10 border-purple-400/30 text-purple-400 hover:bg-purple-400/20"
    />
  );
}

// ---------------------------------------------------------------------------
// Bet Modal
// ---------------------------------------------------------------------------

function directionLabel(dir: Direction, ev: SportEvent | null): string {
  if (dir === "home") return ev?.homeTeam ?? "HOME";
  if (dir === "away") return ev?.awayTeam ?? "AWAY";
  return "DRAW";
}

interface SportBetModalProps {
  event: SportEvent | null;
  direction: Direction | null;
  sportKey: string;
  onClose: () => void;
  onRefetch?: () => void;
}

type InputMode = "sats" | "usd";
const SATS_PRESETS = [546, 1000, 5000, 10000];
const USD_PRESETS  = [0.5, 1, 5, 10];

function AmountToggle({ mode, onChange }: { mode: InputMode; onChange: (m: InputMode) => void }) {
  return (
    <div className="flex gap-0 p-0.5 rounded-md bg-muted/50 border border-border/40 w-fit self-end">
      {(["sats", "usd"] as InputMode[]).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)}
          className={`px-3 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider transition-colors ${
            mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}>
          {m === "sats" ? "⚡ Sats" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

function SportBetModal({ event, direction, sportKey, onClose, onRefetch }: SportBetModalProps) {
  const { toast } = useToast();
  const [inputMode, setInputMode] = useState<InputMode>("usd");
  const [rawAmount, setRawAmount] = useState("0.5");
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [betStatus, setBetStatus] = useState<SportBetStatus | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [showPreimage, setShowPreimage] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);
  const [btcPrice, setBtcPrice] = useState(APPROX_BTC_USD);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setWeblnAvailable(typeof window.webln !== "undefined"); }, []);

  useEffect(() => {
    fetch(apiUrl("/api/market/current?asset=btc"))
      .then((r) => r.json())
      .then((d: { btcPriceUsd?: number }) => { if (d.btcPriceUsd && d.btcPriceUsd > 0) setBtcPrice(d.btcPriceUsd); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!paymentHash) return;
    if (betStatus && betStatus.status !== "pending") return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/sports-poly/bets/${paymentHash}`));
        if (!res.ok) return;
        const data = (await res.json()) as SportBetStatus;
        setBetStatus(data);
        if (data.status !== "pending") {
          clearInterval(pollRef.current!);
          if (data.status === "paid" || data.status === "won" || data.status === "refunded") saveSportBetHashForKey(sportKey, paymentHash);
          if (data.status === "paid") { onRefetch?.(); }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [paymentHash, betStatus?.status]);

  const satsNum = inputMode === "sats"
    ? (parseInt(rawAmount, 10) || 0)
    : Math.round((parseFloat(rawAmount) || 0) / btcPrice * BTC_SATS);
  const usdNum = inputMode === "usd"
    ? (parseFloat(rawAmount) || 0)
    : (satsNum / BTC_SATS * btcPrice);
  const selectedPoolSats = event && direction
    ? direction === "home"
      ? event.totalHomeSats
      : direction === "away"
      ? event.totalAwaySats
      : (event.totalDrawSats ?? 0)
    : 0;
  const totalPoolSats = event
    ? event.totalHomeSats + event.totalAwaySats + (event.totalDrawSats ?? 0)
    : 0;
  const projectedPayout = getProjectedPayout({
    stakeSats: satsNum,
    selectedPoolSats,
    totalPoolSats,
  });

  const handleModeChange = (m: InputMode) => {
    setInputMode(m);
    setRawAmount(m === "sats" ? "1000" : "0.5");
  };

  const handleClose = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setInputMode("usd"); setRawAmount("0.5");
    setPaymentHash(null); setPaymentRequest(null);
    setBetStatus(null); setShowPreimage(false); setPreimageInput(""); setCreating(false);
    onClose();
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sats = satsNum;
    if (!sats || usdNum < 0.50) {
      toast({ title: "Invalid amount", description: "Minimum bet is $0.50 USD", variant: "destructive" });
      return;
    }
    if (!event || !direction) return;
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/sports-poly/bets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: event.marketId, outcomeKey: direction, amountSats: sats }),
      });
      const data = await res.json() as { paymentHash?: string; paymentRequest?: string; error?: string };
      if (!res.ok || !data.paymentHash) {
        toast({ title: "Error", description: data.error ?? "Failed to create bet", variant: "destructive" });
        return;
      }
      setPaymentHash(data.paymentHash);
      setPaymentRequest(data.paymentRequest!);
      saveSportBetHashForKey(sportKey, data.paymentHash);
    } catch {
      toast({ title: "Error", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const copyInvoice = () => {
    if (paymentRequest) { navigator.clipboard.writeText(paymentRequest); toast({ title: "Copied!", duration: 2000 }); }
  };

  const submitPreimage = async (preimage: string) => {
    if (!paymentHash) return;
    const res = await fetch(apiUrl(`/api/sports-poly/bets/${paymentHash}/verify`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preimage }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Verification failed");
    }
    const statusRes = await fetch(apiUrl(`/api/sports-poly/bets/${paymentHash}`));
    if (statusRes.ok) setBetStatus(await statusRes.json() as SportBetStatus);
  };

  const handleWeblnPay = async () => {
    if (!paymentRequest || !window.webln) return;
    setWeblnPaying(true);
    try {
      await window.webln.enable();
      const result = await window.webln.sendPayment(paymentRequest);
      await submitPreimage(result.preimage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      if (!msg.toLowerCase().includes("user rejected") && !msg.toLowerCase().includes("cancelled")) {
        toast({ title: "Payment failed", description: msg, variant: "destructive" });
      }
    } finally {
      setWeblnPaying(false);
    }
  };

  const handleManualVerify = async () => {
    const trimmed = preimageInput.trim().toLowerCase();
    if (!trimmed || trimmed.length !== 64) {
      toast({ title: "Invalid preimage", description: "Must be 64 hex characters", variant: "destructive" });
      return;
    }
    setVerifyingPreimage(true);
    try {
      await submitPreimage(trimmed);
      setShowPreimage(false); setPreimageInput("");
    } catch (err) {
      toast({ title: "Verification failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setVerifyingPreimage(false);
    }
  };

  const isOpen = !!event && !!direction;
  const validSats = usdNum >= 0.50;
  const teamLabel = direction && event ? directionLabel(direction, event) : "";
  const colors = direction ? DIRECTION_COLORS[direction] : DIRECTION_COLORS.home;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md lg:max-w-lg border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap">
            <span className={colors.text}>
              {direction === "home" ? "↑" : direction === "away" ? "↓" : "="} {DIRECTION_LABELS[direction ?? "home"]}
            </span>
            <span className="text-muted-foreground font-normal text-sm truncate">{teamLabel}</span>
          </DialogTitle>
          {event && <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{event.league}</p>}
        </DialogHeader>

        {!paymentRequest && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground uppercase text-xs tracking-wider">
                  Amount ({inputMode === "sats" ? "Sats" : "USD"})
                </Label>
                <AmountToggle mode={inputMode} onChange={handleModeChange} />
              </div>
              {inputMode === "usd" ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input id="sport-amount" type="number" min="0" step="any"
                    value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                    className="pl-8 text-xl font-bold h-12 bg-card/50" autoFocus />
                </div>
              ) : (
                <Input id="sport-amount" type="number" min="1" step="1"
                  value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                  className="text-xl font-bold h-12 bg-card/50" autoFocus />
              )}
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Min: $0.50 USD</span>
                {inputMode === "sats"
                  ? <span>≈ ${usdNum.toFixed(2)} USD</span>
                  : <span>≈ {formatSats(satsNum)} sats</span>
                }
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {inputMode === "sats"
                ? SATS_PRESETS.map((v) => (
                    <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                      className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                      {v >= 1000 ? `${v / 1000}k` : v}
                    </button>
                  ))
                : USD_PRESETS.map((v) => (
                    <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                      className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                      ${v}
                    </button>
                  ))
              }
            </div>

            {SHOW_PROJECTED_PAYOUT_UI && projectedPayout && (
              <div className="rounded-lg border border-border/50 bg-card/40 px-3 py-2.5 text-[11px] font-mono">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-foreground">{formatSats(satsNum)} sats</span>
                  <span className={projectedPayout.profitSats >= 0 ? "text-green-400" : "text-yellow-400"}>
                    {projectedPayout.roiPct >= 0 ? "+" : ""}{projectedPayout.roiPct.toFixed(1)}% if win
                  </span>
                </div>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <span className="text-muted-foreground uppercase tracking-wider">Projected payout</span>
                  <span className="text-muted-foreground">
                    {formatSats(projectedPayout.payoutSats)} sats total
                  </span>
                </div>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <span className="text-muted-foreground uppercase tracking-wider">Net</span>
                  <span className="text-muted-foreground">
                    {projectedPayout.profitSats >= 0 ? "+" : ""}{formatSats(projectedPayout.profitSats)} sats
                  </span>
                </div>
              </div>
            )}

            <Button type="submit" disabled={creating || !validSats}
              className={`w-full h-auto min-h-12 py-3 text-base font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-1 ${colors.cta}`}>
              <span>{creating ? "Generating invoice…" : "Generate Invoice"}</span>
              {SHOW_PROJECTED_PAYOUT_UI && projectedPayout && !creating && (
                <span className="text-[10px] font-normal opacity-90">
                  {formatSats(satsNum)} sats · {projectedPayout.roiPct >= 0 ? "+" : ""}{projectedPayout.roiPct.toFixed(1)}% if win
                </span>
              )}
            </Button>
          </form>
        )}

        {paymentRequest && (betStatus?.status === "pending" || !betStatus) && (
          <div className="pt-1 space-y-3">
            <div className="text-center">
              <p className="text-xl font-bold text-yellow-400">Pay {formatSats(satsNum)} sats</p>
              <p className={`text-xs mt-0.5 ${colors.text}`}>
                {direction === "home" ? "↑" : direction === "away" ? "↓" : "="} {DIRECTION_LABELS[direction ?? "home"]} · {teamLabel}
              </p>
            </div>
            <div className="flex justify-center">
              <div className="bg-white p-2.5 rounded-xl shadow-lg cursor-pointer relative group" onClick={copyInvoice}>
                <QRCodeSVG value={paymentRequest} size={180} level="M" includeMargin={false} />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                  <Copy className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>
            <button type="button" onClick={copyInvoice}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden">
              <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">{paymentRequest.slice(0, 30)}…</span>
              <span className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-bold uppercase tracking-wider">
                <Copy className="h-3.5 w-3.5" /> Copy
              </span>
            </button>
            <div className="flex items-center justify-center gap-2 text-yellow-500 text-sm animate-pulse uppercase tracking-wider font-bold">
              <Clock className="h-4 w-4 shrink-0" /> Waiting for payment…
            </div>
            {weblnAvailable && (
              <Button onClick={handleWeblnPay} disabled={weblnPaying}
                className="w-full h-10 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black text-sm">
                <Zap className="h-4 w-4 mr-2" />
                {weblnPaying ? "Paying…" : "Pay with WebLN"}
              </Button>
            )}
            <div className="border border-muted rounded-lg overflow-hidden">
              <button type="button" onClick={() => setShowPreimage(!showPreimage)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors">
                <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Already paid? Verify manually</span>
                {showPreimage ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showPreimage && (
                <div className="px-3 pb-3 space-y-2 bg-muted/10 border-t border-muted">
                  <p className="text-xs text-muted-foreground pt-2 leading-relaxed">
                    Paste the 64-char hex <strong className="text-foreground">preimage</strong> shown by your wallet after payment.
                  </p>
                  <Input placeholder="Paste 64-char preimage…" value={preimageInput}
                    onChange={(e) => setPreimageInput(e.target.value)} className="font-mono text-xs bg-background" />
                  <Button onClick={handleManualVerify} disabled={verifyingPreimage || preimageInput.trim().length !== 64}
                    className="w-full font-bold uppercase tracking-wider" variant="outline" size="sm">
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {verifyingPreimage ? "Verifying…" : "Confirm Payment"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {betStatus?.status === "paid" && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div className="text-xl font-bold uppercase tracking-wider text-green-500">Bet Placed!</div>
            <p className="text-muted-foreground text-sm text-center">
              Rooting for <strong>{teamLabel}</strong>.<br />Payout settles at the final whistle.
            </p>
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
          </div>
        )}

        {betStatus?.status === "won" && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <Trophy className="h-14 w-14 text-yellow-400" />
            <div className="text-xl font-bold uppercase tracking-wider text-yellow-400">You Won!</div>
            <p className="text-muted-foreground text-sm text-center">
              {betStatus.payoutSats ? `Payout: ${formatSats(Number(betStatus.payoutSats))} sats` : ""}
            </p>
            {betStatus.withdrawLnurl && (
              <div className="bg-white p-2.5 rounded-xl">
                <QRCodeSVG value={betStatus.withdrawLnurl} size={160} level="M" />
              </div>
            )}
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
          </div>
        )}

        {betStatus?.status === "refunded" && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div className="text-xl font-bold uppercase tracking-wider text-green-500">Refund Ready</div>
            <p className="text-muted-foreground text-sm text-center">
              No opposing bets were placed. Your stake returns as REFUND (0.5% fee).
              {betStatus.payoutSats ? ` ${formatSats(Number(betStatus.payoutSats))} sats` : ""}
            </p>
            {betStatus.withdrawLnurl && (
              <div className="bg-white p-2.5 rounded-xl">
                <QRCodeSVG value={betStatus.withdrawLnurl} size={160} level="M" />
              </div>
            )}
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
          </div>
        )}

        {(betStatus?.status === "lost" || betStatus?.status === "expired") && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <XCircle className="h-14 w-14 text-red-500" />
            <div className="text-xl font-bold uppercase tracking-wider text-red-500">
              {betStatus.status === "lost" ? "Better luck next time" : "Invoice Expired"}
            </div>
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upcoming match card
// ---------------------------------------------------------------------------

function UpcomingCard({
  ev,
  onBet,
  sportDef,
  userStakeByDirection,
}: {
  ev: SportEvent;
  onBet: (dir: Direction) => void;
  sportDef: SportDef;
  userStakeByDirection?: Partial<Record<Direction, number>>;
}) {
  const msToKickoff = msTillKickoff(ev.startsAt);
  const bettingClosed = msToKickoff > 0 && msToKickoff < EVENT_IMMINENT_MS;
  const settled = ev.marketStatus === "settled";
  const dirs: Direction[] = sportDef.hasDraw ? ["home", "draw", "away"] : ["home", "away"];
  const totalPoolSats = ev.totalHomeSats + ev.totalAwaySats + (ev.totalDrawSats ?? 0);
  return (
    <div className={`rounded-xl border ${sportDef.cardClass} card-safe p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-2 min-w-0 flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {ev.leagueLogo && <img src={ev.leagueLogo} alt={ev.league} className="h-4 w-4 object-contain shrink-0" />}
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">{ev.league}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="h-3 w-3" />{formatKickoff(ev.startsAt)}
        </div>
      </div>
      <div className="card-row-between-wrap">
        <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="max-w-full truncate text-xs font-semibold text-center leading-tight">{ev.homeTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">HOME</span>
        </div>
        <span className="text-base font-bold font-mono text-muted-foreground">VS</span>
        <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
          <span className="max-w-full truncate text-xs font-semibold text-center leading-tight">{ev.awayTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">AWAY</span>
        </div>
      </div>
      {settled ? (
        <div className="text-center text-[11px] text-muted-foreground font-mono py-1">Market settled</div>
      ) : bettingClosed ? (
        <div className="text-center text-[11px] text-yellow-500/80 font-mono py-1 animate-pulse">
          ⏳ Betting closed — event imminent
        </div>
      ) : (
        <div className={`grid gap-1.5 ${sportDef.hasDraw ? "grid-cols-3" : "grid-cols-2"}`}>
          {dirs.map((dir) => {
            const dirSats = dir === "home" ? ev.totalHomeSats : dir === "away" ? ev.totalAwaySats : (ev.totalDrawSats ?? 0);
            const poolMultiple = getPoolMultiple({ selectedPoolSats: dirSats, totalPoolSats });
            const genericRoiPct = poolMultiple ? (poolMultiple - 1) * 100 : null;
            const userStakeSats = userStakeByDirection?.[dir] ?? 0;
            const opposingPoolSats = Math.max(0, totalPoolSats - dirSats);
            const userStakeProjection = getCurrentStakePayout({
              stakeSats: userStakeSats,
              selectedPoolSats: dirSats,
              totalPoolSats,
            });
            const returnLabel = opposingPoolSats > 0
              ? formatReturnPercent(userStakeProjection?.roiPct ?? genericRoiPct)
              : null;
            return (
              <Button key={dir} size="sm" onClick={() => onBet(dir)}
                className={`text-[11px] sm:text-xs lg:text-sm font-mono font-bold transition-all flex flex-col justify-center min-h-[4.75rem] sm:min-h-[5.5rem] lg:min-h-[6rem] px-2 py-2 gap-1 ${DIRECTION_COLORS[dir].btn}`}>
                <span>{dir === "home" ? "↑" : dir === "away" ? "↓" : "="} {DIRECTION_LABELS[dir]}</span>
                <>
                  <span className={`${sportDef.hasDraw ? "text-[8px]" : "text-[9px]"} font-normal leading-none opacity-70`}>
                    {formatSats(dirSats)} sats in pool
                  </span>
                  {userStakeSats > 0 && (
                    <span className={`${sportDef.hasDraw ? "text-[8px]" : "text-[9px]"} font-normal leading-none opacity-80`}>
                      You: {formatSats(userStakeSats)} sats
                    </span>
                  )}
                  {returnLabel ? (
                    <span className={`${sportDef.hasDraw ? "text-[9px]" : "text-[10px]"} leading-none opacity-90`}>
                      {returnLabel}
                    </span>
                  ) : null}
                </>
              </Button>
            );
          })}
        </div>
      )}
      <PoolBar homeSats={ev.totalHomeSats} drawSats={ev.totalDrawSats ?? 0} awaySats={ev.totalAwaySats} hasDraw={sportDef.hasDraw} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finished card
// ---------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: SportEvent["outcome"] }) {
  if (!outcome) return null;
  if (outcome === "home") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">HOME WIN</Badge>;
  if (outcome === "away") return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">AWAY WIN</Badge>;
  return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">DRAW</Badge>;
}

function getResolvedOutcomeLabel(ev: SportEvent) {
  if (ev.marketOutcome === "home") return ev.homeTeam;
  if (ev.marketOutcome === "away") return ev.awayTeam;
  if (ev.marketOutcome === "draw") return "Draw";
  return null;
}

function ResultCard({ ev, sportDef }: { ev: SportEvent; sportDef: SportDef }) {
  const hasStarted = new Date(ev.startsAt).getTime() <= Date.now();
  const isImminent = ev.status === "upcoming" && hasStarted;
  const isLive = ev.status === "live";
  const settled = ev.marketStatus === "settled";
  const finishedAt = ev.marketFinishedAt;
  const settledAt = ev.marketSettledAt;
  const liveLabel = ev.elapsed ? `LIVE · ${ev.elapsed}'` : "LIVE NOW";

  return (
    <div className={`rounded-xl border ${sportDef.resultCardClass} card-safe p-3 space-y-2.5`}>
      {/* League + badges */}
      <div className="flex items-center justify-between gap-2 min-w-0 flex-nowrap">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {ev.leagueLogo && <img src={ev.leagueLogo} alt={ev.league} className="h-4 w-4 object-contain shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            {ev.league}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 whitespace-nowrap">
          {isLive ? (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">{liveLabel}</Badge>
          ) : isImminent ? (
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">EVENT IMMINENT</Badge>
          ) : (
            <OutcomeBadge outcome={ev.outcome} />
          )}
          {settled && <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">SETTLED</Badge>}
        </div>
      </div>

      {/* Teams + score */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="text-xs font-semibold truncate">{ev.homeTeam}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono font-bold text-sm shrink-0">
          {ev.homeScore != null && ev.awayScore != null ? (
            <>
              <span className={ev.outcome === "home" ? "text-green-400" : ""}>{ev.homeScore}</span>
              <span className="text-muted-foreground">–</span>
              <span className={ev.outcome === "away" ? "text-blue-400" : ""}>{ev.awayScore}</span>
            </>
          ) : (
            <span className="text-muted-foreground">–</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="text-xs font-semibold truncate text-right">{ev.awayTeam}</span>
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
        </div>
      </div>

      {/* Outcome description */}
      {(isLive || isImminent || ev.outcome) && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
          <CheckCircle2 className={`h-3 w-3 shrink-0 ${isLive || isImminent ? "text-amber-400" : "text-green-500"}`} />
          {isLive
            ? "Match in progress — final result pending"
            : isImminent
            ? "Betting closed — kickoff approaching"
            : ev.outcome === "draw"
            ? "DRAW — Match finished level"
            : `${ev.outcome === "home" ? ev.homeTeam : ev.awayTeam} wins`}
        </div>
      )}

      {/* Settlement / resolution footer */}
      {settledAt ? (
        <div className="card-row-between-wrap border-t border-border/30 pt-2 text-[10px] text-muted-foreground font-mono">
          <span className="flex items-center gap-1.5 min-w-0">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">Resolved {format(new Date(settledAt), "MMM d, yyyy · HH:mm")} UTC</span>
          </span>
        </div>
      ) : finishedAt ? (
        <div className="card-row-between-wrap border-t border-border/30 pt-2 text-[10px] text-muted-foreground font-mono">
          <span className="flex items-center gap-1.5 min-w-0">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">Finished {format(new Date(finishedAt), "MMM d, yyyy · HH:mm")} UTC</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Bets tab — Sports
// ---------------------------------------------------------------------------

interface SportBetRecord {
  id: number;
  paymentHash: string;
  direction: string;
  amountSats: number;
  status: string;
  payoutSats: number | null;
  withdrawToken: string | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  market: {
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    homeBadge: string | null;
    awayBadge: string | null;
    league: string;
    status: string;
    outcome: string | null;
    startsAt: string;
    homeScore: number | null;
    awayScore: number | null;
    settledAt: string | null;
  } | null;
}

const SPORT_DIR_STYLES: Record<string, { text: string; cardBg: string; pillBg: string; icon: string; label: string }> = {
  home: { text: "text-green-400", cardBg: "surface-tint-green", pillBg: "bg-green-500/20 border-green-500/50", icon: "↑", label: "HOME" },
  draw: { text: "text-amber-400", cardBg: "surface-tint-amber", pillBg: "bg-amber-500/20 border-amber-500/50", icon: "=", label: "DRAW" },
  away: { text: "text-blue-400",  cardBg: "surface-tint-blue", pillBg: "bg-blue-500/20 border-blue-500/50",   icon: "↓", label: "AWAY" },
};

export function SportBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [bet, setBet] = useState<SportBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showLnInput, setShowLnInput] = useState(false);
  const [lnAddress, setLnAddress] = useState("");
  const [lnPaying, setLnPaying] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = async () => {
    const r = await fetch(apiUrl(`/api/sports-poly/bets/${hash}`));
    if (r.ok) setBet(await r.json() as SportBetRecord);
  };

  const shouldPoll = (d: SportBetRecord) =>
    d.status === "pending" ||
    d.status === "paid" ||
    (d.status === "won" && d.withdrawStatus === "unclaimed") ||
    (d.status === "refunded" && d.withdrawStatus === "unclaimed");

  const pollInterval = (d: SportBetRecord) =>
    d.status === "pending" ? 3000
    : (d.status === "won" && d.withdrawStatus === "unclaimed") ? 10000
    : (d.status === "refunded" && d.withdrawStatus === "unclaimed") ? 10000
    : 30000;

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(apiUrl(`/api/sports-poly/bets/${hash}`));
        if (!res.ok) { setNotFound(true); return; }
        const data = await res.json() as SportBetRecord;
        setBet(data);
        if (shouldPoll(data)) {
          pollRef.current = setInterval(async () => {
            const r = await fetch(apiUrl(`/api/sports-poly/bets/${hash}`));
            if (!r.ok) return;
            const d = await r.json() as SportBetRecord;
            setBet(d);
            if (!shouldPoll(d)) clearInterval(pollRef.current!);
          }, pollInterval(data));
        }
      } catch { setNotFound(true); }
    };
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hash]);

  if (notFound) return null;
  if (!bet) return <div className="h-20 rounded-xl border border-border/40 bg-card/30 animate-pulse" />;

  const dir = bet.direction as "home" | "draw" | "away";
  const dirStyle = SPORT_DIR_STYLES[dir] ?? SPORT_DIR_STYLES.home;

  const kickoff = bet.market ? new Date(bet.market.startsAt) : null;
  const now = Date.now();

  const kickoffFormatted = kickoff ? format(kickoff, "MMM d, HH:mm") + " UTC" : null;

  const matchTimeLabel = (() => {
    if (!kickoff) return null;
    const diff = kickoff.getTime() - now;
    if (diff > 3600000) {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      return `in ${h}h ${m}m`;
    }
    if (diff > 60000) return `in ${Math.floor(diff / 60000)}m`;
    return null;
  })();

  const statusInfo = (() => {
    if (bet.status === "pending")
      return { label: "Waiting for payment...", color: "text-yellow-500", pulse: true, icon: Clock };
    if (bet.status === "paid" && bet.market?.status === "live")
      return { label: "Match is live! Waiting for full-time result...", color: "text-orange-400", pulse: true, icon: AlertCircle };
    if (bet.status === "paid" && bet.market?.status === "closed")
      return { label: "Match finished — awaiting settlement...", color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "paid" && matchTimeLabel)
      return { label: `Bet confirmed — kickoff ${matchTimeLabel}`, color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "paid")
      return { label: "Bet confirmed — waiting for result...", color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "lost")
      return { label: "Better luck next time!", color: "text-red-500", pulse: false, icon: XCircle };
    if (bet.status === "expired")
      return { label: "Bet expired", color: "text-muted-foreground", pulse: false, icon: XCircle };
    if (bet.status === "won" && bet.withdrawStatus === "claimed")
      return { label: "Prize claimed! 🎉", color: "text-green-500", pulse: false, icon: CheckCircle2 };
    if (bet.status === "won")
      return { label: "You won! Scan to claim", color: "text-yellow-400", pulse: false, icon: Trophy };
    if (bet.status === "refunded" && bet.withdrawStatus === "claimed")
      return { label: "Refund claimed!", color: "text-green-500", pulse: false, icon: CheckCircle2 };
    if (bet.status === "refunded")
      return { label: "Refund ready to claim (0.5% fee)", color: "text-green-500", pulse: false, icon: CheckCircle2 };
    return null;
  })();

  const scoreStr =
    bet.market && bet.market.homeScore !== null && bet.market.awayScore !== null
      ? `${bet.market.homeScore} – ${bet.market.awayScore}`
      : null;

  const handleCopyLnurl = (lnurl: string) => {
    navigator.clipboard.writeText(lnurl);
    toast({ title: "LNURL copied!", description: "Paste it in your Lightning wallet.", duration: 3000 });
  };

  const handleClaimSuccess = async () => {
    await reload();
    toast({ title: "Withdrawal sent!", description: "Your winnings are on their way.", duration: 4000 });
  };

  const handlePayToAddress = async () => {
    if (!bet?.withdrawToken || !lnAddress.trim()) return;
    setLnPaying(true); setLnError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/sports-poly/withdraw/${bet.withdrawToken}/pay-to-address`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: lnAddress.trim().toLowerCase() }) },
      );
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setLnError(data.error ?? "Payment failed. Try again.");
      } else {
        await reload();
        toast({ title: "Sats sent!", description: `${new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats sent to ${lnAddress.trim()}.`, duration: 5000 });
      }
    } catch { setLnError("Network error. Please try again."); }
    finally { setLnPaying(false); }
  };

  const handleShareX = () => {
    if (!bet || !bet.market) return;
    const sats = new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0);
    const match = `${bet.market.homeTeam} vs ${bet.market.awayTeam}`;
    const pick = dir === "home" ? bet.market.homeTeam : dir === "away" ? bet.market.awayTeam : "Draw";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Called ${pick} correctly in ${match}. Try it at pwsats.com — no accounts, instant Lightning payouts.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = () => {
    if (!bet || !bet.market) return;
    const sats = new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0);
    const match = `${bet.market.homeTeam} vs ${bet.market.awayTeam}`;
    const pick = dir === "home" ? bet.market.homeTeam : dir === "away" ? bet.market.awayTeam : "Draw";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Called ${pick} correctly in ${match}. No accounts — bet and claim entirely via Lightning Network. pwsats.com #Bitcoin #Lightning #Football`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied for Nostr!", description: "Paste it in your Nostr client.", duration: 3000 });
  };

  return (
    <div className={`rounded-xl border ${dirStyle.cardBg} card-safe p-4 font-mono relative`}>
      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header row */}
      <div className="card-row-wrap mb-3 pr-6">
        <span className={`flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border ${dirStyle.pillBg} ${dirStyle.text}`}>
          {dirStyle.icon} {dirStyle.label}
        </span>
        <span className="text-muted-foreground text-xs card-text-safe">
          {new Intl.NumberFormat("en-US").format(bet.amountSats)} sats
        </span>
        {kickoffFormatted && (
          <span className="text-[10px] text-muted-foreground ml-auto card-text-safe">
            {kickoffFormatted}
          </span>
        )}
      </div>

      {/* Match info */}
      {bet.market && (
        <div className="mb-3 space-y-1">
          <div className="card-row-wrap">
            {bet.market.homeBadge && (
              <img
                src={bet.market.homeBadge} alt=""
                className="h-4 w-4 object-contain"
                onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth === 0 || img.naturalHeight === 0) { (img as HTMLImageElement).style.display = "none"; } }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span className="text-xs text-foreground font-semibold card-text-safe">
              {scoreStr
                ? `${bet.market.homeTeam}  ${scoreStr}  ${bet.market.awayTeam}`
                : `${bet.market.homeTeam} vs ${bet.market.awayTeam}`}
            </span>
            {bet.market.awayBadge && (
              <img
                src={bet.market.awayBadge} alt=""
                className="h-4 w-4 object-contain"
                onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth === 0 || img.naturalHeight === 0) { (img as HTMLImageElement).style.display = "none"; } }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">{bet.market.league}</p>
          {bet.market.outcome && (
            <p className="text-[10px] text-muted-foreground">
              Result: <span className={`font-semibold ${bet.market.outcome === dir ? "text-green-400" : "text-red-400"} capitalize`}>
                {bet.market.outcome}
              </span>
              {bet.market.settledAt && (
                <span className="ml-1 opacity-60">· settled {format(new Date(bet.market.settledAt), "MMM d, HH:mm")} UTC</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Payout line */}
      {bet.status === "won" && bet.payoutSats && (
        <div className="text-green-400 text-sm font-bold mb-3">
          +{new Intl.NumberFormat("en-US").format(Number(bet.payoutSats))} sats won
        </div>
      )}
      {bet.status === "refunded" && bet.payoutSats && (
        <div className="text-green-500 text-sm font-bold mb-3">
          {new Intl.NumberFormat("en-US").format(Number(bet.payoutSats))} sats refunded
        </div>
      )}

      {/* Status */}
      {statusInfo && (
        <div className={`card-row-wrap text-xs ${statusInfo.color} ${statusInfo.pulse ? "animate-pulse" : ""} mb-1`}>
          <statusInfo.icon className="h-3.5 w-3.5 shrink-0" />
          {statusInfo.label}
        </div>
      )}

      {/* Share buttons — shown after claimed */}
      {bet.status === "won" && bet.withdrawStatus === "claimed" && (
        <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Share2 className="h-3 w-3" /> Share your win
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm"
              className="flex-1 text-xs font-bold gap-1.5 border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
              onClick={handleShareX}>
              𝕏 Post on X
            </Button>
            <Button variant="outline" size="sm"
              className="flex-1 text-xs font-bold gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              onClick={handleShareNostr}>
              <Zap className="h-3 w-3" /> Copy for Nostr
            </Button>
          </div>
        </div>
      )}

      {/* CLAIM WINNINGS — QR + LNURL flow (won & refunded) */}
      {(bet.status === "won" || bet.status === "refunded") && bet.withdrawStatus === "unclaimed" && bet.withdrawLnurl && (
        <div className="mt-3 space-y-3">
          <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider animate-pulse ${bet.status === "refunded" ? "text-green-500" : "text-yellow-400"}`}>
            <Trophy className="h-3.5 w-3.5" />
            {bet.status === "refunded" ? "Refund ready — scan to claim" : "You won! Scan to claim"}
          </div>
          <div className="flex flex-col items-center gap-3 pt-1">
            <div
              className="bg-white p-3 rounded-lg cursor-pointer relative group"
              onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}
              title="Click to copy LNURL"
            >
              <QRCodeSVG value={bet.withdrawLnurl} size={160} level="M" includeMargin={false} />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                <Copy className="h-6 w-6 text-white" />
              </div>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs"
                onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />Copy LNURL
              </Button>
              <Button variant="default" size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs bg-yellow-500 hover:bg-yellow-400 text-black"
                onClick={handleClaimSuccess}>
                <Gift className="h-3.5 w-3.5 mr-1.5" />I claimed it!
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
              Open your Lightning wallet → Scan QR or paste LNURL → Receive {new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats
            </p>
          </div>

          {/* Lightning address alternative */}
          <div className="border-t border-border/30 pt-3">
            <button
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => { setShowLnInput((v) => !v); setLnError(null); }}>
              <Zap className="h-3 w-3 text-yellow-400" />
              <span>Send to my Lightning address instead</span>
              {showLnInput ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {showLnInput && (
              <div className="mt-2 space-y-2">
                <Input className="h-8 text-xs font-mono" placeholder="yourname@wallet.com"
                  value={lnAddress} onChange={(e) => { setLnAddress(e.target.value); setLnError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !lnPaying) handlePayToAddress(); }}
                  disabled={lnPaying} autoCapitalize="none" autoCorrect="off" />
                {lnError && <p className="text-[10px] text-red-400 leading-relaxed">{lnError}</p>}
                <Button size="sm"
                  className="w-full text-xs font-bold gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-black"
                  disabled={lnPaying || !lnAddress.includes("@")}
                  onClick={handlePayToAddress}>
                  {lnPaying
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                    : <><Zap className="h-3.5 w-3.5" /> Send {new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats</>}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  We resolve your address and pay instantly. No scanning needed.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Won + generating link */}
      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && !bet.withdrawLnurl && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs animate-pulse mt-2">
          <Trophy className="h-3.5 w-3.5" />
          You won {new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats — generating withdrawal link...
        </div>
      )}
    </div>
  );
}

function SeparatedSportsBetList({ hashes, onDismiss }: { hashes: string[]; onDismiss: (hash: string) => void }) {
  const statusQueries = useQueries({
    queries: hashes.map((hash) => ({
      queryKey: [`/api/sports-poly/bets/${hash}`],
      queryFn: async () => {
        const r = await fetch(apiUrl(`/api/sports-poly/bets/${hash}`));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SportBetRecord>;
      },
      staleTime: 20_000,
    })),
  });

  const open: string[] = [];
  const closed: string[] = [];
  hashes.forEach((hash, i) => {
    const d = statusQueries[i]?.data;
    const isOpen =
      !d?.status ||
      d.status === "pending" ||
      d.status === "paid" ||
      (d.status === "won" && d.withdrawStatus === "unclaimed");
    if (isOpen) open.push(hash);
    else closed.push(hash);
  });

  const showSections = open.length > 0 && closed.length > 0;

  const renderCards = (group: string[]) =>
    group.map((hash) => (
      <SportBetStatusCard key={hash} hash={hash} onDismiss={() => onDismiss(hash)} />
    ));

  return (
    <div className="card-stack">
      {showSections ? (
        <>
          <div className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Open ({open.length})
            </p>
            {renderCards(open)}
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Closed ({closed.length})
            </p>
            {renderCards(closed)}
          </div>
        </>
      ) : (
        renderCards(hashes)
      )}
    </div>
  );
}

export function Sports() {
  const [activeSport, setActiveSport] = useState<SportKey>("football");
  const [activeLeague, setActiveLeague] = useState<string>("all");
  const [activeMarketDate, setActiveMarketDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<ContentTab>("upcoming");
  const [data, setData] = useState<{ upcoming: SportEvent[]; live: SportEvent[]; finished: SportEvent[]; suspended: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("Network error. Please try again.");
  const [betModal, setBetModal] = useState<{ event: SportEvent; direction: Direction } | null>(null);
  const [betListVersion, setBetListVersion] = useState(0);
  const [userStakeByMarket, setUserStakeByMarket] = useState<Record<number, Partial<Record<Direction, number>>>>({});
  const [bridgedImminentEvents, setBridgedImminentEvents] = useState<Record<string, SportEvent>>({});
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // One-time migration: move bets saved under the old monolithic key → football bucket
  useEffect(() => { migrateLegacySportsBetHashes(); }, []);

  const fetchData = useCallback((quiet = false) => {
    if (!quiet) { setLoading(true); setError(false); setErrorMessage("Network error. Please try again."); }
    fetch(apiUrl("/api/sports-poly/markets"))
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: PolyMarket[] | null) => {
        const all = Array.isArray(d) ? d.map(polyToSportEvent) : [];
        const sportName = SPORTS.find(s => s.key === activeSport)?.sportName ?? activeSport;
        const filtered = all.filter(ev => {
          if (activeSport === "football") return ev.sport === "Soccer";
          if (activeSportDef.eventIdPrefix) return ev.id.startsWith(activeSportDef.eventIdPrefix);
          return ev.sport === sportName;
        });
        const upcoming = filtered.filter(e => e.status === "upcoming").sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        const finished = filtered.filter(e => e.status === "finished").sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

        const nextData = {
          upcoming,
          live: [],
          finished,
          suspended: false,
        };

        setData(nextData);

        // Refresh the open bet modal with updated event data (pools, etc.)
        setBetModal((current) => {
          if (!current) return current;
          const freshEvent = [...nextData.upcoming, ...nextData.live].find((e) => e.id === current.event.id);
          return freshEvent ? { ...current, event: freshEvent } : current;
        });

        setBridgedImminentEvents((current) => {
          const next = { ...current };
          const fetchedAt = Date.now();

          for (const event of nextData.upcoming) {
            const kickoff = new Date(event.startsAt).getTime();
            if (kickoff <= fetchedAt + EVENT_IMMINENT_MS) {
              next[event.id] = event;
            }
          }

          for (const event of [...nextData.live, ...nextData.finished]) {
            delete next[event.id];
          }

          for (const [eventId, event] of Object.entries(next)) {
            const kickoff = new Date(event.startsAt).getTime();
            if (kickoff < fetchedAt - EVENT_IMMINENT_BRIDGE_MS) {
              delete next[eventId];
            }
          }

          return next;
        });
        setError(false);
      })
      .catch((err: unknown) => {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : "Network error. Please try again.");
      })
      .finally(() => setLoading(false));
  }, [activeSport]);

  useEffect(() => {
    fetchData();
    refreshTimerRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;

    const loadUserStakes = async () => {
      const hashes = activeSport === "basketball"
        ? [...new Set([...getSportBetHashesForKey("basketball"), ...getSportBetHashesForKey("nba")])]
        : getSportBetHashesForKey(activeSport);
      if (hashes.length === 0) {
        if (!cancelled) setUserStakeByMarket({});
        return;
      }

      try {
        const responses = await Promise.all(
          hashes.map(async (hash) => {
            const res = await fetch(apiUrl(`/api/sports-poly/bets/${hash}`));
            if (!res.ok) return null;
            const raw = await res.json();
            // Poly bet response doesn't include market.id, so we match by eventName → marketId
            const matchedMarket = data?.upcoming?.find(
              (ev) => ev.event === raw.market?.eventName
            ) ?? data?.finished?.find((ev) => ev.event === raw.market?.eventName);
            return {
              id: raw.id,
              paymentHash: raw.paymentHash,
              direction: raw.direction,
              amountSats: raw.amountSats,
              status: raw.status,
              marketId: matchedMarket?.marketId ?? null,
            } as SportBetStatus;
          }),
        );

        if (cancelled) return;

        const next: Record<number, Partial<Record<Direction, number>>> = {};
        for (const bet of responses) {
          if (!bet || bet.marketId === null || !isDirection(bet.direction)) continue;
          if (bet.status === "pending" || bet.status === "expired") continue;
          const current = next[bet.marketId] ?? {};
          current[bet.direction] = (current[bet.direction] ?? 0) + bet.amountSats;
          next[bet.marketId] = current;
        }
        setUserStakeByMarket(next);
      } catch {
        if (!cancelled) setUserStakeByMarket({});
      }
    };

    loadUserStakes();
    const timer = setInterval(loadUserStakes, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeSport, betListVersion, data]);

  const activeCategoryDef = CATEGORIES.find((c) => c.sports.includes(activeSport)) ?? CATEGORIES[0]!;
  const visibleCategories = CATEGORIES;
  const subcategorySports = activeCategoryDef.sports
    .map((sk) => SPORTS.find((s) => s.key === sk)!)
    .filter(Boolean);
  const showSubcategoryChips = (activeCategoryDef.showSubcategories ?? false) && subcategorySports.length > 0;

  const activeSportDef = SPORTS.find((s) => s.key === activeSport)!;
  const sportBetHashes = activeSport === "basketball"
    ? [...new Set([...getSportBetHashesForKey("basketball"), ...getSportBetHashesForKey("nba")])]
    : getSportBetHashesForKey(activeSport);
  const now = Date.now();
  const visibleMarketEvents = data
    ? data.upcoming.filter(
        (ev) =>
          (activeSportDef.eventIdPrefix ? ev.id.startsWith(activeSportDef.eventIdPrefix) : ev.sport === activeSportDef.sportName) &&
          ev.status === "upcoming" &&
          new Date(ev.startsAt).getTime() > now,
      )
    : [];
  const leagueOptionsMap = new Map<string, LeagueOption>();
  for (const event of visibleMarketEvents) {
    const option = getLeagueOption(event, activeSport);
    if (!leagueOptionsMap.has(option.value) && option.label.trim().length > 0) {
      leagueOptionsMap.set(option.value, option);
    }
  }
  const leaguePriority = LEAGUE_PRIORITY[activeSport] ?? [];
  const availableLeagues = [...leagueOptionsMap.values()].sort((a, b) => {
    const aRank = leaguePriority.indexOf(a.sortKey);
    const bRank = leaguePriority.indexOf(b.sortKey);
    if (aRank !== -1 || bRank !== -1) {
      if (aRank === -1) return 1;
      if (bRank === -1) return -1;
      return aRank - bRank;
    }
    return a.label.localeCompare(b.label);
  });
  const showLeagueFilter = availableLeagues.length > 0;
  const leagueScopedMarketEvents = visibleMarketEvents.filter((ev) => activeLeague === "all" || getLeagueOption(ev, activeSport).value === activeLeague);
  const marketDateOptionsMap = new Map<string, MarketDateOption>();
  for (const event of leagueScopedMarketEvents) {
    const option = getEventDateOption(event.startsAt);
    const existing = marketDateOptionsMap.get(option.value);
    if (existing) {
      existing.count += 1;
    } else {
      marketDateOptionsMap.set(option.value, { ...option, count: 1 });
    }
  }
  const availableMarketDates = [...marketDateOptionsMap.values()].sort((a, b) => a.sortKey - b.sortKey);
  const showDateFilter = availableMarketDates.length > 0;

  useEffect(() => {
    setActiveLeague("all");
  }, [activeSport]);

  useEffect(() => {
    setActiveMarketDate("");
  }, [activeSport, activeLeague]);

  useEffect(() => {
    if (activeLeague !== "all" && !availableLeagues.some((league) => league.value === activeLeague)) {
      setActiveLeague("all");
    }
  }, [activeLeague, availableLeagues]);

  useEffect(() => {
    if (!availableMarketDates.some((option) => option.value === activeMarketDate)) {
      setActiveMarketDate(availableMarketDates[0]?.value ?? "");
    }
  }, [activeMarketDate, availableMarketDates]);

  const matchesActiveLeague = (ev: SportEvent) =>
    activeLeague === "all" || getLeagueOption(ev, activeSport).value === activeLeague;
  const matchesActiveMarketDate = (ev: SportEvent) =>
    !activeMarketDate || getLocalDateKey(new Date(ev.startsAt)) === activeMarketDate;

  return (
    <div className="max-w-4xl mx-auto lg:max-w-6xl space-y-0">

      {/* ── Category chips ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {visibleCategories.map((cat) => {
          const isActive = activeCategoryDef.key === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => {
                const firstSport = cat.sports[0];
                if (firstSport) setActiveSport(firstSport);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                isActive
                  ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                  : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
              }`}
            >
              <span className="text-sm leading-none">{cat.icon}</span>
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* ── Subcategory chips (visible when category has showSubcategories) ── */}
      {showSubcategoryChips && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
          {subcategorySports.map((sp) => (
            <button
              key={sp.key}
              onClick={() => setActiveSport(sp.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                activeSport === sp.key
                  ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                  : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
              }`}
            >
              {sp.label}
            </button>
          ))}
        </div>
      )}

      {showLeagueFilter && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
            {availableLeagues.length > 1 && (
              <button
                onClick={() => setActiveLeague("all")}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                  activeLeague === "all"
                    ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                    : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
                }`}
              >
                All Leagues
              </button>
            )}
            {availableLeagues.map((league) => (
              <button
                key={league.value}
                onClick={() => setActiveLeague(league.value)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                  activeLeague === league.value || (availableLeagues.length === 1 && activeLeague === "all")
                    ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                    : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
                }`}
              >
                {league.label}
              </button>
            ))}
        </div>
      )}

      {showDateFilter && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
          {availableMarketDates.map((option) => (
            <button
              key={option.value}
              onClick={() => setActiveMarketDate(option.value)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                activeMarketDate === option.value
                  ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                  : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
              }`}
            >
              {option.label} ({option.count})
            </button>
          ))}
        </div>
      )}

      {/* ── Content tabs: Guide | Upcoming | Results ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-4">
        {([
          { key: "upcoming", label: "Markets" },
          { key: "guide",    label: "Guide" },
          { key: "myBets",   label: "My Bets" },
          { key: "results",  label: "Results" },
        ] as { key: ContentTab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-1.5 rounded-md text-[11px] font-mono font-medium transition-colors ${
              activeTab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Guide ── */}
      {activeTab === "guide" && (() => {
        const props = { onDone: () => { setActiveTab("upcoming"); window.scrollTo({ top: 0, behavior: "smooth" }); } };
        if (activeSportDef.key === "football")   return <FootballGuide {...props} />;
        if (activeSportDef.key === "nba")        return <NBAGuide {...props} />;
        if (activeSportDef.key === "mlb")        return <MLBGuide {...props} />;
        if (activeSportDef.key === "mma")        return <MMAGuide {...props} />;
        if (activeSportDef.key === "rugby")      return <RugbyGuide {...props} />;
        if (activeSportDef.key === "basketball") return <BasketballGuide {...props} />;
        return <NFLGuide {...props} />;
      })()}

      {/* ── My Bets ── */}
      {activeTab === "myBets" && (
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeSportDef.icon} {activeSportDef.label} — My Bets
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 text-emerald-400" />
              {sportBetHashes.length} saved
            </span>
          </div>

          {sportBetHashes.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="font-mono text-sm text-foreground">No saved {activeSportDef.label} bets yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bets placed in this browser for {activeSportDef.label.toLowerCase()} will appear here automatically.
              </p>
            </div>
          ) : (
            <SeparatedSportsBetList
              hashes={sportBetHashes}
              onDismiss={(hash) => {
                removeSportBetHashForKey(activeSport, hash);
                setBetListVersion((current) => current + 1);
              }}
            />
          )}
        </div>
      )}

      {/* ── Upcoming Matches ── */}
      {activeTab === "upcoming" && (
        <>
        <div className="card-stack">
          {loading && !data && (
            <LoadingState
              label={`FETCHING ${activeSportDef.hasDraw ? "MATCHES" : "GAMES"}...`}
              className="h-40"
              spinnerClassName="h-5 w-5"
              labelClassName="text-sm"
            />
          )}
          {error && !loading && (
            <ErrorState
              title={`FAILED TO LOAD ${activeSportDef.hasDraw ? "MATCHES" : "GAMES"}`}
              description={errorMessage}
              onRetry={() => fetchData()}
              compact
              cardClassName="border-red-400/20 bg-background/60"
            />
          )}
          {!error && data && (() => {
            const isSuspended = data.suspended;
            const visible = data.upcoming.filter(
              (ev) =>
                (activeSportDef.eventIdPrefix ? ev.id.startsWith(activeSportDef.eventIdPrefix) : ev.sport === activeSportDef.sportName) &&
                ev.status === "upcoming" &&
                matchesActiveLeague(ev) &&
                matchesActiveMarketDate(ev) &&
                new Date(ev.startsAt).getTime() > now
            );
            if (isSuspended)
              return (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <AlertCircle className="h-7 w-7 text-amber-400" />
                  <p className="font-mono text-sm text-amber-400">Sports data temporarily unavailable</p>
                  <p className="font-mono text-xs opacity-60 text-center">
                    The {activeSportDef.label} data provider is currently unreachable.<br/>Retrying automatically every 15 minutes.
                  </p>
                </div>
              );
            if (visible.length === 0)
              return (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <span className="text-4xl">{activeSportDef.icon}</span>
                  <p className="font-mono text-sm font-semibold">No {activeSportDef.label} {activeSportDef.hasDraw ? "matches" : "games"} available right now</p>
                  <p className="font-mono text-xs text-center opacity-60 max-w-xs">
                    There are no open betting markets for {activeSportDef.label} at the moment.<br/>
                    Check back soon — new markets open regularly!
                  </p>
                </div>
              );
            return visible.map((ev) => (
                  <UpcomingCard
                    key={ev.id}
                    ev={ev}
                    sportDef={activeSportDef}
                    userStakeByDirection={ev.marketId !== null ? userStakeByMarket[ev.marketId] : undefined}
                    onBet={(dir) => setBetModal({ event: ev, direction: dir })}
                  />
                ));
          })()}
        </div>
        <button
          onClick={() => setActiveTab("guide")}
          className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground font-mono py-1 transition-colors"
        >
          New here? Read the guide →
        </button>
        </>
      )}

      {/* ── Recent Results ── */}
      {activeTab === "results" && (
        <div className="card-stack">
          {loading && !data && (
            <LoadingState
              label="FETCHING RESULTS..."
              className="h-40"
              spinnerClassName="h-5 w-5"
              labelClassName="text-sm"
            />
          )}
          {error && !loading && (
            <ErrorState
              title="FAILED TO LOAD RESULTS"
              description={errorMessage}
              onRetry={() => fetchData()}
              compact
              cardClassName="border-red-400/20 bg-background/60"
            />
          )}
          {!error && data && (() => {
            const isSuspended = data.suspended;
            const resultCandidates = [
              ...data.live,
              ...data.finished,
              ...data.upcoming.filter((ev) => new Date(ev.startsAt).getTime() <= now),
              ...Object.values(bridgedImminentEvents).filter((ev) => new Date(ev.startsAt).getTime() <= now),
            ];
            const seen = new Set<string>();
            const visible = resultCandidates
              .filter((ev) => {
                if (seen.has(ev.id)) return false;
                seen.add(ev.id);
                return (activeSportDef.eventIdPrefix ? ev.id.startsWith(activeSportDef.eventIdPrefix) : ev.sport === activeSportDef.sportName) && matchesActiveLeague(ev);
              })
              .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime());
            if (isSuspended)
              return (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <AlertCircle className="h-7 w-7 text-amber-400" />
                  <p className="font-mono text-sm text-amber-400">Sports data temporarily unavailable</p>
                  <p className="font-mono text-xs opacity-60 text-center">
                    The {activeSportDef.label} data provider is currently unreachable.<br/>Retrying automatically every 15 minutes.
                  </p>
                </div>
              );
            return visible.length === 0
              ? <p className="text-center text-muted-foreground text-sm py-10 font-mono">No recent or live results.</p>
              : visible.map((ev) => <ResultCard key={ev.id} ev={ev} sportDef={activeSportDef} />);
          })()}
        </div>
      )}

      <SportBetModal
        event={betModal?.event ?? null}
        direction={betModal?.direction ?? null}
        sportKey={activeSport}
        onRefetch={() => fetchData(false)}
        onClose={() => {
          setBetModal(null);
          setBetListVersion((current) => current + 1);
        }}
      />
    </div>
  );
}
