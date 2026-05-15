import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueries } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  Gift,
  Link2,
  ListChecks,
  Loader2,
  RefreshCw,
  Share2,
  Trophy,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  getSportsPolyBetHashes,
  removeSportsPolyBetHash,
  saveSportsPolyBetHash,
} from "@/components/my-bet-widget";
import { GuidePager } from "@/components/guide-pager";
import { ErrorState, LoadingState } from "@/components/query-state";
import { getProjectedPayout } from "@/lib/payout-preview";

type ContentTab = "guide" | "markets" | "myBets" | "results";
type SportsPolyCategoryKey = "soccer" | "nba" | "nfl" | "nhl" | "mlb" | "mma" | "rugby" | "tennis" | "golf" | "cricket" | "esports";
type InputMode = "sats" | "usd";

interface SportsPolyOutcome {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
}

interface SportsPolyMarket {
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
  outcomes: SportsPolyOutcome[];
}

interface SportsPolyBetResult {
  betId: number;
  paymentHash: string;
  paymentRequest: string;
  verifyUrl: string | null;
  amountSats: number;
}

interface SportsPolyBetRecord {
  id: number;
  paymentHash: string;
  direction: string;
  outcomeLabel: string | null;
  amountSats: number;
  status: string;
  payoutSats: number | null;
  withdrawToken: string | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  market: {
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
    status: string;
    outcome: string | null;
    resolvedValue: string | null;
    outcomes: SportsPolyOutcome[];
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

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const APPROX_BTC_USD = 95_000;
const BTC_SATS = 100_000_000;
const MIN_SATS = 250;
const USD_PRESETS = [0.5, 1, 5, 10];
const SATS_PRESETS = [546, 1000, 5000, 10000];
const OUTCOME_COLORS = [
  "bg-amber-500",
  "bg-sky-500",
  "bg-emerald-500",
  "bg-fuchsia-500",
  "bg-rose-500",
  "bg-indigo-500",
] as const;
const SHOW_PROJECTED_PAYOUT_UI = false;

const OUTCOME_BUTTON_STYLES: Record<"home" | "draw" | "away", { icon: string; label: string; btn: string; text: string }> = {
  home: {
    icon: "↑",
    label: "HOME",
    btn: "bg-green-500/10 text-green-400 border border-green-500/40 hover:bg-green-500/20 hover:border-green-500",
    text: "text-green-400",
  },
  draw: {
    icon: "=",
    label: "DRAW",
    btn: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/40 hover:bg-yellow-500/20 hover:border-yellow-500",
    text: "text-yellow-400",
  },
  away: {
    icon: "↓",
    label: "AWAY",
    btn: "bg-blue-500/10 text-blue-400 border border-blue-500/40 hover:bg-blue-500/20 hover:border-blue-500",
    text: "text-blue-400",
  },
};

const SPORTS_POLY_CATEGORIES: Array<{
  key: SportsPolyCategoryKey;
  label: string;
  sportNames: string[];
  icon: string;
  cardClass: string;
  resultCardClass: string;
}> = [
  { key: "soccer", label: "Soccer", sportNames: ["Soccer"], icon: "⚽", cardClass: "surface-tint-green", resultCardClass: "surface-tint-green-soft" },
  { key: "nba", label: "NBA", sportNames: ["Basketball"], icon: "🏀", cardClass: "surface-tint-orange", resultCardClass: "surface-tint-orange-soft" },
  { key: "nfl", label: "NFL", sportNames: ["American Football"], icon: "🏈", cardClass: "surface-tint-indigo", resultCardClass: "surface-tint-indigo-soft" },
  { key: "nhl", label: "NHL", sportNames: ["Hockey"], icon: "🏒", cardClass: "surface-tint-blue", resultCardClass: "surface-tint-blue" },
  { key: "mlb", label: "MLB", sportNames: ["Baseball"], icon: "⚾", cardClass: "surface-tint-red", resultCardClass: "surface-tint-red-soft" },
  { key: "mma", label: "MMA", sportNames: ["MMA"], icon: "🥊", cardClass: "surface-tint-yellow", resultCardClass: "surface-tint-yellow-soft" },
  { key: "rugby", label: "Rugby", sportNames: ["Rugby"], icon: "🏉", cardClass: "surface-tint-emerald", resultCardClass: "surface-tint-emerald-soft" },
  { key: "tennis", label: "Tennis", sportNames: ["Tennis"], icon: "🎾", cardClass: "surface-tint-cyan", resultCardClass: "surface-tint-cyan-soft" },
  { key: "golf", label: "Golf", sportNames: ["Golf"], icon: "⛳", cardClass: "surface-tint-blue", resultCardClass: "surface-tint-blue-soft" },
  { key: "cricket", label: "Cricket", sportNames: ["Cricket"], icon: "🏏", cardClass: "surface-tint-amber", resultCardClass: "surface-tint-amber-soft" },
  { key: "esports", label: "Esports", sportNames: ["Esports"], icon: "🎮", cardClass: "surface-tint-purple", resultCardClass: "surface-tint-purple-soft" },
];

function formatSats(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatStartsAt(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatLeagueLabel(value: string | null) {
  if (!value || value === "Sports" || /polymarket/i.test(value)) return null;
  return value;
}

function categoryFallbackLabel(categoryLabel: string, marketSport: string) {
  return marketSport && marketSport !== "Sports" ? marketSport : categoryLabel;
}

function getMarketMetaLine(market: SportsPolyMarket) {
  return [market.sport, formatLeagueLabel(market.league), formatStartsAt(market.startsAt)]
    .filter(Boolean)
    .join(" · ");
}

function getSafeOutcomeList(outcomes: SportsPolyOutcome[] | null | undefined): SportsPolyOutcome[] {
  return Array.isArray(outcomes) ? outcomes : [];
}

function getTotalPool(outcomes: SportsPolyOutcome[] | null | undefined) {
  return getSafeOutcomeList(outcomes).reduce((sum, outcome) => sum + outcome.poolSats, 0);
}

function getDefaultSegmentWidth(outcomes: SportsPolyOutcome[] | null | undefined) {
  const count = getSafeOutcomeList(outcomes).length;
  return count > 0 ? 100 / count : 100;
}

function getOutcomeAccent(index: number) {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

function getOutcomeButtonStyle(outcome: SportsPolyOutcome, index: number) {
  if (outcome.key === "home" || outcome.key === "draw" || outcome.key === "away") {
    return OUTCOME_BUTTON_STYLES[outcome.key];
  }

  return {
    icon: "•",
    label: outcome.label.toUpperCase(),
    btn: "bg-background/30 border border-border/60 hover:bg-muted/40",
    text: "text-foreground",
  };
}

function teamInitials(name: string | null | undefined) {
  const source = (name ?? "").trim();
  if (!source) return "??";

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function TeamBadge({ src, name, size = "sm" }: { src: string | null; name: string; size?: "sm" | "lg" }) {
  const [error, setError] = useState(false);
  const dim = size === "lg" ? "w-12 h-12 text-sm" : "w-10 h-10 text-[11px]";
  if (src && !error) {
    return (
      <img
        src={src}
        alt={name}
        className={`${size === "lg" ? "w-12 h-12" : "w-10 h-10"} object-contain shrink-0`}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth === 0 || img.naturalHeight === 0) {
            setError(true);
          }
        }}
        onError={() => setError(true)}
      />
    );
  }

  return (
    <div className={`${dim} rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground shrink-0`}>
      {teamInitials(name)}
    </div>
  );
}

function AmountToggle({ mode, onChange }: { mode: InputMode; onChange: (mode: InputMode) => void }) {
  return (
    <div className="flex gap-0 p-0.5 rounded-md bg-muted/50 border border-border/40 w-fit self-end">
      {(["sats", "usd"] as InputMode[]).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`px-3 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider transition-colors ${
            mode === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {value === "sats" ? "⚡ Sats" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

function marketMatchesCategory(market: SportsPolyMarket, categoryKey: SportsPolyCategoryKey) {
  const category = SPORTS_POLY_CATEGORIES.find((entry) => entry.key === categoryKey);
  if (!category) return true;
  return category.sportNames.includes(market.sport);
}

function getActiveCategoryDef(categoryKey: SportsPolyCategoryKey) {
  return SPORTS_POLY_CATEGORIES.find((entry) => entry.key === categoryKey) ?? SPORTS_POLY_CATEGORIES[0];
}

function getOrderedOutcomes(outcomes: SportsPolyOutcome[] | null | undefined) {
  return getSafeOutcomeList(outcomes)
    .map((outcome, index) => ({ outcome, index }))
    .sort((left, right) => {
      if (left.outcome.isWinner !== right.outcome.isWinner) {
        return left.outcome.isWinner === true ? -1 : 1;
      }

      if (left.outcome.poolSats !== right.outcome.poolSats) {
        return right.outcome.poolSats - left.outcome.poolSats;
      }

      return left.index - right.index;
    });
}

function getLiquidityLabel(outcome: SportsPolyOutcome, outcomes: SportsPolyOutcome[] | null | undefined) {
  const totalPool = getTotalPool(outcomes);
  if (totalPool <= 0) return "No liquidity";
  return `${((outcome.poolSats / totalPool) * 100).toFixed(1)}% liquidity`;
}

async function fetchSportsPolyMarkets(): Promise<SportsPolyMarket[]> {
  const res = await fetch(`${API_BASE}/api/sports-poly/markets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SportsPolyMarket[]>;
}

const GUIDE_STEPS = [
  {
    icon: BookOpen,
    color: "text-amber-400",
    iconBg: "bg-amber-400/15 border-amber-400/40",
    cardTint: "bg-amber-400/5",
    cardBorder: "border-amber-400/30",
    title: "Expanded Sports Feed",
    body: "This section adds extra sports markets to the app while keeping the same local bet, payout and settlement flow used elsewhere.",
  },
  {
    icon: ListChecks,
    color: "text-sky-400",
    iconBg: "bg-sky-400/15 border-sky-400/40",
    cardTint: "bg-sky-400/5",
    cardBorder: "border-sky-400/30",
    title: "Multi-Outcome Ready",
    body: "Markets can expose two or more outcomes. Each outcome shows implied price and the local sats pool tracked in the app.",
  },
  {
    icon: Wallet,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Bet With Lightning",
    body: "Choose an outcome, generate a Lightning invoice, and pay from any wallet. Paid bets stay visible in My Bets for later claim.",
  },
  {
    icon: Gift,
    color: "text-fuchsia-400",
    iconBg: "bg-fuchsia-400/15 border-fuchsia-400/40",
    cardTint: "bg-fuchsia-400/5",
    cardBorder: "border-fuchsia-400/30",
    title: "Resolution & Payout",
    body: "When a market resolves, local winners split the local sats pool proportionally, minus the same platform fee used by the other categories. If no opposing outcome receives bets, your stake returns as REFUND minus a 0.5% refund fee.",
  },
];

function SportsPolyGuide({ onDone }: { onDone?: () => void }) {
  return (
    <GuidePager
      steps={GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <Trophy className="text-white w-4 h-4" />
          </div>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Sports+ Guide</h2>
        </>
      }
      ctaClass="bg-amber-400/10 border-amber-400/30 text-amber-400 hover:bg-amber-400/20"
    />
  );
}

function OutcomePoolBar({ outcomes }: { outcomes: SportsPolyOutcome[] }) {
  const safeOutcomes = getSafeOutcomeList(outcomes);
  const total = getTotalPool(safeOutcomes);
  const home = safeOutcomes.find((outcome) => outcome.key === "home")?.poolSats ?? 0;
  const draw = safeOutcomes.find((outcome) => outcome.key === "draw")?.poolSats ?? 0;
  const away = safeOutcomes.find((outcome) => outcome.key === "away")?.poolSats ?? 0;
  const supportsLegacyBar =
    safeOutcomes.length >= 2 &&
    safeOutcomes.length <= 3 &&
    safeOutcomes.every((outcome) => ["home", "draw", "away"].includes(outcome.key));

  if (supportsLegacyBar) {
    const hasDraw = safeOutcomes.some((outcome) => outcome.key === "draw");
    const defaultShare = hasDraw ? 100 / 3 : 50;
    const pHome = total > 0 ? (home / total) * 100 : defaultShare;
    const pDraw = total > 0 ? (draw / total) * 100 : (hasDraw ? defaultShare : 0);
    const pAway = total > 0 ? (away / total) * 100 : defaultShare;

    return (
      <div className="space-y-1.5">
        <div className="flex justify-between items-center font-mono text-xs mb-1">
          <span className="font-bold text-green-500">{pHome.toFixed(1)}% HOME</span>
          <span className="text-[10px] text-muted-foreground">Pool: {formatSats(total)} sats</span>
          <span className="font-bold text-blue-500">{pAway.toFixed(1)}% AWAY</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          <div className="bg-green-500 transition-all" style={{ width: `${pHome}%` }} />
          {hasDraw ? <div className="bg-yellow-400 transition-all" style={{ width: `${pDraw}%` }} /> : null}
          <div className="bg-blue-500 transition-all" style={{ width: `${pAway}%` }} />
        </div>
        {hasDraw ? (
          <div className="text-center text-[10px] font-mono font-bold text-yellow-400">
            {pDraw.toFixed(1)}% DRAW
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="text-muted-foreground uppercase tracking-wider">Outcome Pools</span>
        <span className="text-muted-foreground">Pool: {formatSats(total)} sats</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted/30">
        {safeOutcomes.map((outcome, index) => {
          const width = total > 0 ? (outcome.poolSats / total) * 100 : getDefaultSegmentWidth(safeOutcomes);
          return (
            <div
              key={outcome.key}
              className={`${getOutcomeAccent(index)} transition-all`}
              style={{ width: `${width}%` }}
              title={`${outcome.label}: ${formatSats(outcome.poolSats)} sats`}
            />
          );
        })}
      </div>
      <div className="grid gap-1">
        {safeOutcomes.map((outcome, index) => (
          <div key={outcome.key} className="flex items-center justify-between gap-3 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 rounded-full ${getOutcomeAccent(index)}`} />
              <span className="truncate">{outcome.label}</span>
            </span>
            <span className="shrink-0">{formatSats(outcome.poolSats)} sats</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SportsPolyBetModal({
  market,
  outcome,
  outcomeIndex,
  onClose,
}: {
  market: SportsPolyMarket;
  outcome: SportsPolyOutcome;
  outcomeIndex: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [inputMode, setInputMode] = useState<InputMode>("usd");
  const [rawAmount, setRawAmount] = useState("0.5");
  const [invoice, setInvoice] = useState<SportsPolyBetResult | null>(null);
  const [betPaid, setBetPaid] = useState(false);
  const [copying, setCopying] = useState(false);
  const [btcPrice, setBtcPrice] = useState(APPROX_BTC_USD);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setWeblnAvailable(typeof window.webln !== "undefined");
    fetch(`${API_BASE}/api/market/current?asset=btc`)
      .then((r) => r.json())
      .then((data: { btcPriceUsd?: number }) => {
        if (data.btcPriceUsd && data.btcPriceUsd > 0) setBtcPrice(data.btcPriceUsd);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const hash = invoice?.paymentHash;
    if (!hash || betPaid) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sports-poly/bets/${hash}`);
        if (!res.ok) return;
        const data = await res.json() as { status: string };
        if (["paid", "won", "lost"].includes(data.status)) {
          setBetPaid(true);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Ignore intermittent polling errors.
      }
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [invoice?.paymentHash, betPaid]);

  const amountSats = inputMode === "sats"
    ? (Number.parseInt(rawAmount, 10) || 0)
    : Math.round(((Number.parseFloat(rawAmount) || 0) / btcPrice) * BTC_SATS);
  const amountUsd = inputMode === "usd"
    ? (Number.parseFloat(rawAmount) || 0)
    : (amountSats / BTC_SATS) * btcPrice;
  const totalPoolSats = getTotalPool(market.outcomes);
  const projectedPayout = getProjectedPayout({
    stakeSats: amountSats,
    selectedPoolSats: outcome.poolSats,
    totalPoolSats,
  });
  const isValid = amountSats >= MIN_SATS && amountUsd >= 0.5;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/sports-poly/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: market.id,
          outcomeKey: outcome.key,
          amountSats,
        }),
      });

      if (!res.ok) {
        const error = await res.json() as { error?: string };
        throw new Error(error.error ?? "Failed to create sports invoice");
      }

      return res.json() as Promise<SportsPolyBetResult>;
    },
    onSuccess: (data) => {
      setInvoice(data);
      saveSportsPolyBetHash(data.paymentHash);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyInvoice = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.paymentRequest);
    setCopying(true);
    window.setTimeout(() => setCopying(false), 2000);
  };

  const handleModeChange = (nextMode: InputMode) => {
    setInputMode(nextMode);
    setRawAmount(nextMode === "sats" ? "1000" : "0.5");
  };

  const handleWebLn = async () => {
    if (!invoice || !window.webln) return;

    try {
      await window.webln.enable();
      const result = await window.webln.sendPayment(invoice.paymentRequest);
      const preimage = result?.preimage;
      if (typeof preimage === "string" && preimage.length === 64) {
        await fetch(`${API_BASE}/api/sports-poly/bets/${invoice.paymentHash}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preimage }),
        });
      }
      setBetPaid(true);
      toast({ title: "Payment sent!", description: "Your sports bet is confirmed." });
    } catch {
      toast({ title: "WebLN failed", description: "Please scan the QR code instead.", variant: "destructive" });
    }
  };

  const handleManualVerify = async () => {
    if (!invoice || preimageInput.trim().length !== 64) return;

    setVerifyingPreimage(true);
    try {
      const res = await fetch(`${API_BASE}/api/sports-poly/bets/${invoice.paymentHash}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preimage: preimageInput.trim() }),
      });
      if (!res.ok) throw new Error("Verification failed");
      setBetPaid(true);
      toast({ title: "Payment verified!", description: "Your sports bet is confirmed." });
    } catch {
      toast({ title: "Verification failed", description: "Invalid preimage or payment not found.", variant: "destructive" });
    } finally {
      setVerifyingPreimage(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            Place Sports Bet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3 text-sm bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">
              {[formatLeagueLabel(market.league), formatStartsAt(market.startsAt)].filter(Boolean).join(" · ")}
            </p>
            <p className="font-bold">{market.eventName}</p>
            <p className="font-bold mt-2 flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${getOutcomeAccent(outcomeIndex)}`} />
              <span>{outcome.label}</span>
              <span className="text-muted-foreground text-xs">{getLiquidityLabel(outcome, market.outcomes)}</span>
            </p>
          </div>

          {!invoice ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Amount ({inputMode === "sats" ? "Sats" : "USD"})
                  </label>
                  <AmountToggle mode={inputMode} onChange={handleModeChange} />
                </div>
                {inputMode === "usd" ? (
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={rawAmount}
                      onChange={(e) => setRawAmount(e.target.value)}
                      className="pl-8 font-mono text-xl font-bold h-12 bg-card/50"
                      autoFocus
                    />
                  </div>
                ) : (
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={rawAmount}
                    onChange={(e) => setRawAmount(e.target.value)}
                    className="font-mono text-xl font-bold h-12 bg-card/50"
                    autoFocus
                  />
                )}
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Min: $0.50 USD</span>
                  {inputMode === "sats"
                    ? <span>≈ ${amountUsd.toFixed(2)} USD</span>
                    : <span>≈ {formatSats(amountSats)} sats</span>}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {(inputMode === "sats" ? SATS_PRESETS : USD_PRESETS).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRawAmount(String(value))}
                    className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors"
                  >
                    {inputMode === "sats"
                      ? (value >= 1000 ? `${value / 1000}k` : value)
                      : `$${value}`}
                  </button>
                ))}
              </div>

              {SHOW_PROJECTED_PAYOUT_UI && projectedPayout && (
                <div className="rounded-lg border border-border/50 bg-card/40 px-3 py-2.5 text-[11px] font-mono">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-foreground">{formatSats(amountSats)} sats</span>
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

              <Button
                className="w-full h-auto min-h-12 py-3 text-base font-bold uppercase tracking-wider text-black bg-amber-400 hover:bg-amber-500 flex flex-col items-center justify-center gap-1"
                disabled={!isValid || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                <span>{mutation.isPending ? "Generating…" : "Generate Invoice"}</span>
                {SHOW_PROJECTED_PAYOUT_UI && projectedPayout && !mutation.isPending && (
                  <span className="text-[10px] font-normal opacity-80">
                    {formatSats(amountSats)} sats · {projectedPayout.roiPct >= 0 ? "+" : ""}{projectedPayout.roiPct.toFixed(1)}% if win
                  </span>
                )}
              </Button>
            </>
          ) : betPaid ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="text-sm font-bold text-green-400 uppercase tracking-wider">Bet Confirmed!</p>
              <p className="text-xs text-muted-foreground text-center">
                Your pick has been added to the local sats pool for this market.
              </p>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          ) : (
            <div className="pt-1 space-y-3">
              <div className="text-center">
                <p className="text-xl font-bold text-yellow-400">Pay {formatSats(invoice.amountSats)} sats</p>
                <p className="text-xs mt-0.5 text-muted-foreground">{outcome.label}</p>
              </div>

              <div className="flex justify-center">
                <div className="bg-white p-2.5 rounded-xl shadow-lg cursor-pointer relative group" onClick={handleCopyInvoice}>
                  <QRCodeSVG value={invoice.paymentRequest} size={180} level="M" includeMargin={false} />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                    <Copy className="h-8 w-8 text-white" />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyInvoice}
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden"
              >
                <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">
                  {invoice.paymentRequest.slice(0, 30)}…
                </span>
                <span className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-bold uppercase tracking-wider">
                  <Copy className="h-3.5 w-3.5" /> {copying ? "Copied!" : "Copy"}
                </span>
              </button>

              {weblnAvailable && (
                <Button variant="outline" className="w-full gap-2" onClick={handleWebLn}>
                  <Zap className="h-4 w-4" /> Pay with WebLN
                </Button>
              )}

              <div className="space-y-2 rounded-lg border border-border/50 p-3 bg-muted/20">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Manual verify</p>
                <Input
                  value={preimageInput}
                  onChange={(e) => setPreimageInput(e.target.value)}
                  placeholder="Paste payment preimage"
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={verifyingPreimage || preimageInput.trim().length !== 64}
                  onClick={handleManualVerify}
                >
                  {verifyingPreimage ? "Verifying…" : "Verify Payment"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SportsPolyMarketCard({
  market,
  onBetCreated,
  categoryDef,
}: {
  market: SportsPolyMarket;
  onBetCreated?: () => void;
  categoryDef: ReturnType<typeof getActiveCategoryDef>;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState<{ outcome: SportsPolyOutcome; index: number } | null>(null);
  const outcomes = getOrderedOutcomes(market.outcomes);
  const isSettled = market.status === "settled";
  const winner = outcomes.find(({ outcome }) => outcome.isWinner === true)?.outcome ?? null;
  const hasHomeAwayLayout = Boolean(market.homeTeam || market.awayTeam);
  const leagueLabel = formatLeagueLabel(market.league);

  return (
    <div className={`rounded-xl border ${isSettled ? categoryDef.resultCardClass : categoryDef.cardClass} card-safe p-3 space-y-2.5`}>
      <div className="flex items-center justify-between gap-2 min-w-0 flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {market.leagueLogo ? (
            <img src={market.leagueLogo} alt={leagueLabel ?? market.league} className="h-4 w-4 object-contain shrink-0" />
          ) : null}
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
            {leagueLabel ?? categoryFallbackLabel(categoryDef.label, market.sport)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="h-3 w-3" />
          {formatStartsAt(market.startsAt)}
        </div>
      </div>

      {hasHomeAwayLayout ? (
        <div className="card-row-between-wrap">
          <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
            <TeamBadge src={market.homeBadge} name={market.homeTeam ?? "Home"} />
            <span className="max-w-full truncate text-xs font-semibold text-center leading-tight">{market.homeTeam ?? "Home"}</span>
            <span className="text-[9px] text-muted-foreground font-mono">HOME</span>
          </div>
          <span className="text-base font-bold font-mono text-muted-foreground">VS</span>
          <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
            <TeamBadge src={market.awayBadge} name={market.awayTeam ?? "Away"} />
            <span className="max-w-full truncate text-xs font-semibold text-center leading-tight">{market.awayTeam ?? "Away"}</span>
            <span className="text-[9px] text-muted-foreground font-mono">AWAY</span>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="truncate text-sm font-mono font-semibold">{market.eventName}</p>
          <p className="truncate text-[11px] text-muted-foreground font-mono">{market.question}</p>
        </div>
      )}

      {isSettled ? (
        <div className="space-y-2">
          <div className="card-row-between-wrap">
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-mono font-bold text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              {winner?.label ?? market.resolvedValue ?? "Resolved"}
            </span>
            {market.settledAt ? (
              <span className="text-[10px] text-muted-foreground font-mono">
                Resolved {format(new Date(market.settledAt), "MMM d · HH:mm")} UTC
              </span>
            ) : null}
          </div>
          <OutcomePoolBar outcomes={market.outcomes} />
        </div>
      ) : (
        <>
          <div className={`grid gap-1.5 ${outcomes.length >= 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {outcomes.map(({ outcome }, index) => {
              const style = getOutcomeButtonStyle(outcome, index);
              return (
                <Button
                  key={outcome.key}
                  size="sm"
                  onClick={() => setSelectedOutcome({ outcome, index })}
                  className={`h-14 text-[11px] font-mono font-bold transition-all flex flex-col gap-0.5 ${style.btn}`}
                >
                  <span>{style.icon} {style.label}</span>
                  <span className="text-[9px] font-normal opacity-70">{formatSats(outcome.poolSats)} sats in pool</span>
                </Button>
              );
            })}
          </div>
          <OutcomePoolBar outcomes={market.outcomes} />
        </>
      )}

      {selectedOutcome ? (
        <SportsPolyBetModal
          market={market}
          outcome={selectedOutcome.outcome}
          outcomeIndex={selectedOutcome.index}
          onClose={() => {
            setSelectedOutcome(null);
            onBetCreated?.();
          }}
        />
      ) : null}
    </div>
  );
}

export function SportsPolyBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [bet, setBet] = useState<SportsPolyBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showLnInput, setShowLnInput] = useState(false);
  const [lnAddress, setLnAddress] = useState("");
  const [lnPaying, setLnPaying] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = async () => {
    const res = await fetch(`${API_BASE}/api/sports-poly/bets/${hash}`);
    if (res.ok) setBet(await res.json() as SportsPolyBetRecord);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sports-poly/bets/${hash}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }

        const data = await res.json() as SportsPolyBetRecord;
        setBet(data);

        if (["pending", "paid"].includes(data.status) || (data.status === "won" && data.withdrawStatus === "unclaimed")) {
          pollRef.current = setInterval(async () => {
            const refreshed = await fetch(`${API_BASE}/api/sports-poly/bets/${hash}`);
            if (!refreshed.ok) return;
            const next = await refreshed.json() as SportsPolyBetRecord;
            setBet(next);
            if (!["pending", "paid"].includes(next.status) && !(next.status === "won" && next.withdrawStatus === "unclaimed")) {
              if (pollRef.current) clearInterval(pollRef.current);
            }
          }, data.status === "pending" ? 3000 : 10000);
        }
      } catch {
        setNotFound(true);
      }
    };

    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hash]);

  if (notFound) return null;
  if (!bet) return <div className="h-20 rounded-xl border border-border/40 bg-card/30 animate-pulse" />;

  const outcomeLabel = bet.outcomeLabel ?? bet.direction;
  const winnerLabel = bet.market?.resolvedValue ?? null;
  const statusInfo = (() => {
    if (bet.status === "pending") return { label: "Waiting for payment...", color: "text-yellow-500", icon: Clock };
    if (bet.status === "paid") return { label: "Bet confirmed — waiting for market resolution", color: "text-blue-400", icon: CheckCircle2 };
    if (bet.status === "lost") return { label: "This outcome did not win", color: "text-red-500", icon: XCircle };
    if (bet.status === "expired") return { label: "Bet expired", color: "text-muted-foreground", icon: XCircle };
    if (bet.status === "won" && bet.withdrawStatus === "claimed") return { label: "Prize claimed", color: "text-green-500", icon: CheckCircle2 };
    if (bet.status === "won") return { label: "Winning bet ready to claim", color: "text-green-500", icon: Trophy };
    return null;
  })();

  const handleCopyLnurl = async (lnurl: string) => {
    await navigator.clipboard.writeText(lnurl);
    toast({ title: "LNURL copied!", description: "Paste it in your Lightning wallet.", duration: 3000 });
  };

  const handleClaimSuccess = async () => {
    await reload();
    toast({ title: "Withdrawal sent!", description: "Your winnings are on their way.", duration: 4000 });
  };

  const handlePayToAddress = async () => {
    if (!bet.withdrawToken || !lnAddress.trim()) return;

    setLnPaying(true);
    setLnError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sports-poly/withdraw/${bet.withdrawToken}/pay-to-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: lnAddress.trim() }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to send payout");
      }
      await handleClaimSuccess();
    } catch (err) {
      setLnError(err instanceof Error ? err.message : "Failed to send payout");
    } finally {
      setLnPaying(false);
    }
  };

  const handleShareX = () => {
    if (!bet.market) return;
    const sats = formatSats(bet.payoutSats ?? 0);
    const text = `⚡ Just won ${sats} sats on Predictions With Sats on "${bet.market.eventName}" with outcome "${outcomeLabel}".`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = async () => {
    if (!bet.market) return;
    const sats = formatSats(bet.payoutSats ?? 0);
    const text = `⚡ Just won ${sats} sats on Predictions With Sats on "${bet.market.eventName}" with outcome "${outcomeLabel}".`;
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied for Nostr!", description: "Paste it in your Nostr client.", duration: 3000 });
  };

  return (
    <div className="rounded-xl border bg-card/40 card-safe p-4 font-mono relative">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="card-row-wrap mb-3 pr-6">
        <span className="flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border border-amber-400/40 bg-amber-500/10 text-amber-300">
          <Trophy className="h-3 w-3" /> {outcomeLabel}
        </span>
        <span className="text-muted-foreground text-xs">{formatSats(bet.amountSats)} sats</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{bet.market ? formatStartsAt(bet.market.startsAt) : ""}</span>
      </div>

      {bet.market && (
        <div className="mb-3 space-y-1">
          <p className="text-xs text-foreground font-semibold">{bet.market.eventName}</p>
          {winnerLabel && (
            <p className="text-[10px] text-muted-foreground">
              Winning outcome: <span className="text-foreground font-semibold">{winnerLabel}</span>
            </p>
          )}
        </div>
      )}

      {bet.status === "won" && bet.payoutSats && (
        <div className="text-green-400 text-sm font-bold mb-3">
          +{formatSats(Number(bet.payoutSats))} sats won
        </div>
      )}

      {statusInfo && (
        <div className={`flex items-center gap-2 text-xs ${statusInfo.color} mb-1`}>
          <statusInfo.icon className="h-3.5 w-3.5 shrink-0" />
          {statusInfo.label}
        </div>
      )}

      {bet.status === "won" && bet.withdrawStatus === "claimed" && (
        <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Share2 className="h-3 w-3" /> Share your win
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-xs font-bold gap-1.5" onClick={handleShareX}>
              𝕏 Post on X
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs font-bold gap-1.5" onClick={handleShareNostr}>
              <Zap className="h-3 w-3" /> Copy for Nostr
            </Button>
          </div>
        </div>
      )}

      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && bet.withdrawLnurl && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold uppercase tracking-wider animate-pulse">
            <Trophy className="h-3.5 w-3.5" />
            You won! Scan to claim
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
              <Button variant="outline" size="sm" className="flex-1" onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy LNURL
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowLnInput((current) => !current)}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" /> LN Address
              </Button>
            </div>

            {showLnInput && (
              <div className="w-full space-y-2">
                <Input
                  value={lnAddress}
                  onChange={(e) => setLnAddress(e.target.value)}
                  placeholder="name@wallet.com"
                  className="font-mono"
                />
                {lnError && <p className="text-xs text-red-400">{lnError}</p>}
                <Button className="w-full" disabled={lnPaying || !lnAddress.trim()} onClick={handlePayToAddress}>
                  {lnPaying ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...
                    </>
                  ) : (
                    "Send to Lightning Address"
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SeparatedSportsPolyBetList({ hashes, onDismiss }: { hashes: string[]; onDismiss: (hash: string) => void }) {
  const statusQueries = useQueries({
    queries: hashes.map((hash) => ({
      queryKey: [`/api/sports-poly/bets/${hash}`],
      queryFn: async () => {
        const r = await fetch(`${API_BASE}/api/sports-poly/bets/${hash}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SportsPolyBetRecord>;
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
      <SportsPolyBetStatusCard key={hash} hash={hash} onDismiss={() => onDismiss(hash)} />
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

export function SportsPoly() {
  const [activeTab, setActiveTab] = useState<ContentTab>("markets");
  const [activeCategory, setActiveCategory] = useState<SportsPolyCategoryKey>("soccer");
  const [betListVersion, setBetListVersion] = useState(0);

  const {
    data: markets,
    isLoading,
    error,
    refetch,
  } = useQuery<SportsPolyMarket[]>({
    queryKey: ["/api/sports-poly/markets"],
    queryFn: fetchSportsPolyMarkets,
    refetchInterval: 60_000,
  });

  const openMarkets = (markets ?? []).filter((market) => market.status === "open");
  const settledMarkets = (markets ?? []).filter((market) => market.status === "settled");
  const sortedOpenMarkets = [...openMarkets].sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
  const sortedSettledMarkets = [...settledMarkets].sort(
    (left, right) =>
      new Date(right.settledAt ?? right.startsAt).getTime() -
      new Date(left.settledAt ?? left.startsAt).getTime(),
  );
  const filteredOpenMarkets = sortedOpenMarkets.filter((market) => marketMatchesCategory(market, activeCategory));
  const filteredSettledMarkets = sortedSettledMarkets.filter((market) => marketMatchesCategory(market, activeCategory));
  const sportsPolyBetHashes = getSportsPolyBetHashes();
  const activeCategoryDef = getActiveCategoryDef(activeCategory);
  void betListVersion;

  return (
    <div className="max-w-4xl mx-auto space-y-0">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {SPORTS_POLY_CATEGORIES.map((category) => (
          <button
            key={category.key}
            onClick={() => setActiveCategory(category.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
              activeCategory === category.key
                ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
            }`}
          >
            <span className="text-sm leading-none">{category.icon}</span>
            {category.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-4">
          {([
            { key: "markets", label: "Markets" },
            { key: "guide", label: "Guide" },
            { key: "myBets", label: "My Bets" },
            { key: "results", label: "Results" },
          ] as { key: ContentTab; label: string }[]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-1.5 rounded-md text-[11px] font-mono font-medium transition-colors ${
                activeTab === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      {activeTab === "guide" && (
        <SportsPolyGuide onDone={() => { setActiveTab("markets"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      )}

      {activeTab === "myBets" && (
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeCategoryDef.icon} {activeCategoryDef.label} — My Bets
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 text-emerald-400" />
              {sportsPolyBetHashes.length} saved
            </span>
          </div>

          {sportsPolyBetHashes.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="font-mono text-sm text-foreground">No saved sports bets yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bets placed in this browser for these markets will appear here automatically.
              </p>
            </div>
          ) : (
            <SeparatedSportsPolyBetList
              hashes={sportsPolyBetHashes}
              onDismiss={(hash) => {
                removeSportsPolyBetHash(hash);
                setBetListVersion((current) => current + 1);
              }}
            />
          )}
        </div>
      )}

      {activeTab === "markets" && (
        <>
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeCategoryDef.icon} {activeCategoryDef.label} — Markets
            </p>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {isLoading ? (
            <LoadingState
              label="FETCHING MARKETS..."
              className="h-40"
              spinnerClassName="h-5 w-5"
              labelClassName="text-sm"
            />
          ) : error ? (
            <ErrorState
              title="FAILED TO LOAD MARKETS"
              description={error instanceof Error ? error.message : "Network error. Please try again."}
              onRetry={() => refetch()}
              compact
              cardClassName="border-red-400/20 bg-background/60"
            />
          ) : openMarkets.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
              <p className="font-mono text-sm text-foreground">No open sports markets right now.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                There are no active match markets at the moment. Recent settled markets are still available in Results.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => setActiveTab("results")}>
                View Recent Results
              </Button>
            </div>
          ) : filteredOpenMarkets.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-400" />
              <p className="font-mono text-sm text-foreground">No open markets in this subcategory.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                When new markets are available for this sport, they will appear here.
              </p>
            </div>
          ) : (
            filteredOpenMarkets.map((market) => (
              <SportsPolyMarketCard
                key={market.id}
                market={market}
                categoryDef={activeCategoryDef}
                onBetCreated={() => setBetListVersion((current) => current + 1)}
              />
            ))
          )}
        </div>
        <button
          onClick={() => setActiveTab("guide")}
          className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground font-mono py-1 transition-colors"
        >
          New here? Read the guide →
        </button>
        </>
      )}

      {activeTab === "results" && (
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeCategoryDef.icon} {activeCategoryDef.label} — Recent Results
            </p>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {isLoading ? (
            <LoadingState
              label="FETCHING RESULTS..."
              className="h-40"
              spinnerClassName="h-5 w-5"
              labelClassName="text-sm"
            />
          ) : error ? (
            <ErrorState
              title="FAILED TO LOAD RESULTS"
              description={error instanceof Error ? error.message : "Network error. Please try again."}
              onRetry={() => refetch()}
              compact
              cardClassName="border-red-400/20 bg-background/60"
            />
          ) : filteredSettledMarkets.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-mono text-sm text-foreground">No resolved markets in this subcategory yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Resolved markets will show up here once synced and settled locally.
              </p>
            </div>
          ) : (
            filteredSettledMarkets.map((market) => (
              <SportsPolyMarketCard key={market.id} market={market} categoryDef={activeCategoryDef} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
