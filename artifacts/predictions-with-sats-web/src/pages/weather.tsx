import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Cloud,
  Clock,
  Copy,
  Gift,
  Link2,
  ListChecks,
  Loader2,
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
  getWeatherBetHashes,
  removeWeatherBetHash,
  saveWeatherBetHash,
} from "@/components/my-bet-widget";
import { GuidePager } from "@/components/guide-pager";
import { ErrorState, LoadingState } from "@/components/query-state";
import { getPoolMultiple, getProjectedPayout } from "@/lib/payout-preview";

type ContentTab = "guide" | "markets" | "myBets" | "results";
type MarketPeriodFilter = "today" | "tomorrow";
type InputMode = "sats" | "usd";

interface WeatherOutcome {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
}

interface WeatherMarket {
  id: number;
  city: string;
  country: string;
  emoji: string;
  date: string;
  threshold: number;
  question?: string | null;
  subtitle: string | null;
  sourceUrl: string | null;
  status: "open" | "settled";
  outcome: string | null;
  actualTemp: number | null;
  totalYesSats: number;
  totalNoSats: number;
  settledAt: string | null;
  resolvedValue: string | null;
  provider: string;
  outcomes: WeatherOutcome[];
}

interface WeatherBetResult {
  betId: number;
  paymentHash: string;
  paymentRequest: string;
  verifyUrl: string | null;
  amountSats: number;
}

interface WeatherBetRecord {
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
    city: string;
    date: string;
    threshold: number;
    question: string | null;
    subtitle: string | null;
    status: string;
    outcome: string | null;
    actualTemp: number | null;
    resolvedValue: string | null;
    outcomes: WeatherOutcome[];
  } | null;
}

function getBetMarketQuestion(market: NonNullable<WeatherBetRecord["market"]>) {
  return `Highest temperature in ${market.city}`;
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
const USD_PRESETS = [0.5, 1, 5, 10];
const SATS_PRESETS = [546, 1000, 5000, 10000];
const DEFAULT_VISIBLE_OUTCOMES = 6;
const OUTCOME_COLORS = [
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-fuchsia-500",
  "bg-sky-500",
  "bg-rose-500",
] as const;
const SHOW_PROJECTED_PAYOUT_UI = false;

function formatDate(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatSats(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function ensureOutcomes(outcomes: WeatherOutcome[] | null | undefined): WeatherOutcome[] {
  return Array.isArray(outcomes) ? outcomes : [];
}

function getTotalPool(outcomes: WeatherOutcome[] | null | undefined) {
  const safeOutcomes = ensureOutcomes(outcomes);
  return safeOutcomes.reduce((sum, outcome) => sum + outcome.poolSats, 0);
}

function getWinningOutcomeLabel(outcomes: WeatherOutcome[] | null | undefined) {
  return ensureOutcomes(outcomes).find((outcome) => outcome.isWinner === true)?.label ?? null;
}

function getOutcomeCount(outcomes: WeatherOutcome[] | null | undefined) {
  return ensureOutcomes(outcomes).length;
}

function getDefaultSegmentWidth(outcomes: WeatherOutcome[] | null | undefined) {
  const count = getOutcomeCount(outcomes);
  return count > 0 ? 100 / count : 100;
}

function getSafeOutcomeList(outcomes: WeatherOutcome[] | null | undefined) {
  return ensureOutcomes(outcomes);
}

function getLocalPoolPercent(outcome: WeatherOutcome, outcomes: WeatherOutcome[] | null | undefined) {
  const totalPool = getTotalPool(outcomes);
  if (totalPool <= 0) return null;
  return (outcome.poolSats / totalPool) * 100;
}

function getLiquidityLabel(outcome: WeatherOutcome, outcomes: WeatherOutcome[] | null | undefined) {
  const percent = getLocalPoolPercent(outcome, outcomes);
  return percent === null ? "No liquidity" : `${percent.toFixed(1)}% liquidity`;
}

function getResolvedLabel(market: WeatherMarket) {
  return market.resolvedValue ?? getWinningOutcomeLabel(market.outcomes) ?? "Resolved";
}

function getMarketQuestion(market: WeatherMarket) {
  return `Highest temperature in ${market.city}`;
}

function getMarketSubhead(market: WeatherMarket) {
  return `Pick the final temperature range for ${formatDate(market.date)}.`;
}

function getOutcomeAccent(index: number) {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}

function getOrderedOutcomes(outcomes: WeatherOutcome[] | null | undefined) {
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

function getOrderedCityOptions(markets: WeatherMarket[] | null | undefined) {
  const orderedCities: string[] = [];
  const seen = new Set<string>();

  for (const market of markets ?? []) {
    if (seen.has(market.city)) continue;
    seen.add(market.city);
    orderedCities.push(market.city);
  }

  return ["all", ...orderedCities];
}

async function fetchWeatherMarkets(): Promise<WeatherMarket[]> {
  const res = await fetch(`${API_BASE}/api/weather/markets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<WeatherMarket[]>;
}

const GUIDE_STEPS = [
  {
    icon: BookOpen,
    color: "text-cyan-400",
    iconBg: "bg-cyan-400/15 border-cyan-400/40",
    cardTint: "bg-cyan-400/5",
    cardBorder: "border-cyan-400/30",
    title: "How It Works",
    body: "Each market asks for the highest temperature in a city on a specific date. You pick one outcome and place your bet in sats through Lightning.",
  },
  {
    icon: ListChecks,
    color: "text-amber-400",
    iconBg: "bg-amber-400/15 border-amber-400/40",
    cardTint: "bg-amber-400/5",
    cardBorder: "border-amber-400/30",
    title: "Multi-Outcome Markets",
    body: "Markets can have more than two outcomes. Each outcome has its own button, implied probability, and local sats pool shown on the card.",
  },
  {
    icon: Wallet,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Bet With Lightning",
    body: "Choosing an outcome still generates a Lightning invoice in the existing flow. Paid bets are tracked locally and remain visible in My Bets.",
  },
  {
    icon: Gift,
    color: "text-fuchsia-400",
    iconBg: "bg-fuchsia-400/15 border-fuchsia-400/40",
    cardTint: "bg-fuchsia-400/5",
    cardBorder: "border-fuchsia-400/30",
    title: "Payouts",
    body: "Each outcome pool is still tracked in sats. When the external market resolves, local winners split the total pool proportionally, minus the existing fee. If no opposing outcome receives bets, your stake returns as REFUND minus a 0.5% refund fee.",
  },
];

function WeatherGuide({ onDone }: { onDone?: () => void }) {
  return (
    <GuidePager
      steps={GUIDE_STEPS}
      onDone={onDone}
      header={
        <>
          <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center shrink-0">
            <Cloud className="text-white w-4 h-4" />
          </div>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Weather Betting Guide</h2>
        </>
      }
      ctaClass="bg-cyan-400/10 border-cyan-400/30 text-cyan-400 hover:bg-cyan-400/20"
    />
  );
}

function OutcomePoolBar({ outcomes }: { outcomes: WeatherOutcome[] }) {
  const safeOutcomes = getSafeOutcomeList(outcomes);
  const total = getTotalPool(safeOutcomes);

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

function WeatherAmountToggle({ mode, onChange }: { mode: InputMode; onChange: (mode: InputMode) => void }) {
  return (
    <div className="flex gap-0 p-0.5 rounded-md bg-muted/50 border border-border/40 w-fit self-end">
      {(["sats", "usd"] as InputMode[]).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          className={`px-3 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider transition-colors ${
            mode === candidate ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {candidate === "sats" ? "⚡ Sats" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

function WeatherBetModal({
  market,
  outcome,
  outcomeIndex,
  onClose,
}: {
  market: WeatherMarket;
  outcome: WeatherOutcome;
  outcomeIndex: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [inputMode, setInputMode] = useState<InputMode>("usd");
  const [rawAmount, setRawAmount] = useState("0.5");
  const [invoice, setInvoice] = useState<WeatherBetResult | null>(null);
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
        const res = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (["paid", "won", "lost", "refunded"].includes(data.status)) {
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
  const isValid = amountUsd >= 0.5;
  const totalPoolSats = getTotalPool(market.outcomes);
  const opposingLiquiditySats = Math.max(0, totalPoolSats - outcome.poolSats);
  const projectedPayout = getProjectedPayout({
    stakeSats: amountSats,
    selectedPoolSats: outcome.poolSats,
    totalPoolSats,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/weather/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: market.id,
          outcomeKey: outcome.key,
          amountUsd,
        }),
      });

      if (!res.ok) {
        const error = (await res.json()) as { error?: string };
        throw new Error(error.error ?? "Failed to create weather invoice");
      }

      return res.json() as Promise<WeatherBetResult>;
    },
    onSuccess: (data) => {
      setInvoice(data);
      saveWeatherBetHash(data.paymentHash);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleModeChange = (nextMode: InputMode) => {
    setInputMode(nextMode);
    setRawAmount(nextMode === "sats" ? "1000" : "0.5");
  };

  const handleCopyInvoice = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.paymentRequest);
    setCopying(true);
    window.setTimeout(() => setCopying(false), 2000);
  };

  const handleWebLn = async () => {
    if (!invoice || !window.webln) return;

    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.paymentRequest);
      setBetPaid(true);
      toast({ title: "Payment sent!", description: "Your weather bet is confirmed." });
    } catch {
      toast({ title: "WebLN failed", description: "Please scan the QR code instead.", variant: "destructive" });
    }
  };

  const handleManualVerify = async () => {
    if (!invoice || preimageInput.trim().length !== 64) return;

    setVerifyingPreimage(true);
    try {
      const res = await fetch(`${API_BASE}/api/weather/bets/${invoice.paymentHash}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preimage: preimageInput.trim() }),
      });
      if (!res.ok) throw new Error("Verification failed");
      setBetPaid(true);
      toast({ title: "Payment verified!", description: "Your weather bet is confirmed." });
    } catch {
      toast({ title: "Verification failed", description: "Invalid preimage or payment not found.", variant: "destructive" });
    } finally {
      setVerifyingPreimage(false);
    }
  };

  const accent = getOutcomeAccent(outcomeIndex);
  const liquidityLabel = getLiquidityLabel(outcome, market.outcomes);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
            <Cloud className="h-4 w-4 text-cyan-400" />
            Place Weather Bet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3 text-sm bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">{market.emoji} {market.city} · {formatDate(market.date)}</p>
            <p className="font-bold">{getMarketQuestion(market)}</p>
            <p className="text-xs text-muted-foreground mt-1">{getMarketSubhead(market)}</p>
            <p className="font-bold mt-2 flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${accent}`} />
              <span>{outcome.label}</span>
              <span className="text-muted-foreground text-xs">{liquidityLabel}</span>
            </p>
          </div>

          {!invoice ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Amount ({inputMode === "sats" ? "Sats" : "USD"})
                  </label>
                  <WeatherAmountToggle mode={inputMode} onChange={handleModeChange} />
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
                      placeholder="1.00"
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
                className="w-full h-auto min-h-12 py-3 text-base font-bold uppercase tracking-wider text-white bg-cyan-600 hover:bg-cyan-700 flex flex-col items-center justify-center gap-1"
                disabled={!isValid || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                <span>{mutation.isPending ? "Generating…" : "Generate Invoice"}</span>
                {SHOW_PROJECTED_PAYOUT_UI && projectedPayout && !mutation.isPending && (
                  <span className="text-[10px] font-normal opacity-90">
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

function useCountdown(deadlineIso: string) {
  const [remaining, setRemaining] = useState(() => new Date(deadlineIso).getTime() - Date.now());

  useEffect(() => {
    const deadline = new Date(deadlineIso).getTime();
    const id = window.setInterval(() => setRemaining(deadline - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);

  if (remaining <= 0) return { label: "Closing", urgent: true, critical: true };

  const totalSecs = Math.floor(remaining / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;

  return {
    label,
    urgent: remaining < 3 * 60 * 60 * 1000,
    critical: remaining < 60 * 60 * 1000,
  };
}

function MarketCard({
  market,
  onBetCreated,
}: {
  market: WeatherMarket;
  onBetCreated?: () => void;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState<{ outcome: WeatherOutcome; index: number } | null>(null);
  const [showAllOutcomes, setShowAllOutcomes] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const deadline = `${market.date}T23:59:59Z`;
  const countdown = useCountdown(deadline);
  const outcomes = getSafeOutcomeList(market.outcomes);
  const orderedOutcomes = getOrderedOutcomes(outcomes);
  const visibleOutcomes = showAllOutcomes ? orderedOutcomes : orderedOutcomes.slice(0, DEFAULT_VISIBLE_OUTCOMES);
  const hiddenOutcomeCount = Math.max(orderedOutcomes.length - DEFAULT_VISIBLE_OUTCOMES, 0);
  const totalPool = getTotalPool(outcomes);
  const isSettled = market.status === "settled";
  const isPendingResult = !isSettled && market.date < today;
  const isBettable = !isSettled && !isPendingResult;

  return (
    <div className="rounded-xl border surface-tint-cyan card-safe p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 min-w-0 flex-nowrap">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-lg leading-none">{market.emoji}</span>
            <span className="font-bold font-mono text-sm truncate">{market.city}</span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">{formatDate(market.date)}</p>
        </div>

        {isSettled ? (
          <div className="shrink-0 text-right">
            <span className="inline-flex items-center text-green-400 font-bold font-mono text-xs bg-green-400/10 px-2 py-0.5 rounded">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {getResolvedLabel(market)}
            </span>
          </div>
        ) : isPendingResult ? (
          <div className="shrink-0 flex items-center gap-1 text-xs font-mono font-bold text-amber-400">
            <Clock className="h-3 w-3" />
            Settlement pending
          </div>
        ) : (
          <div className={`shrink-0 flex items-center gap-1 text-xs font-mono font-bold ${
            countdown.critical ? "text-red-400" : countdown.urgent ? "text-amber-400" : "text-muted-foreground"
          }`}>
            <Clock className="h-3 w-3" />
            {countdown.label}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-mono font-semibold">{getMarketQuestion(market)}</p>
        <p className="text-xs text-muted-foreground">{getMarketSubhead(market)}</p>
      </div>

      {isSettled && market.settledAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono border-t border-border/30 pt-2">
          <Clock className="h-3 w-3 shrink-0" />
          Resolved {format(new Date(market.settledAt), "MMM d, yyyy · HH:mm")} UTC
        </div>
      )}

      {isPendingResult && (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-300 font-mono border-t border-border/30 pt-2">
          <Clock className="h-3 w-3 shrink-0" />
          Market closed externally, waiting for resolved outcome
        </div>
      )}

      {outcomes.length === 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] font-mono text-amber-300">
          Outcomes not synced yet for this market.
        </div>
      ) : (
        <div className="grid gap-2">
          {visibleOutcomes.map(({ outcome }, index) => {
            const accent = getOutcomeAccent(index);
            const isWinner = outcome.isWinner === true;
            const liquidityLabel = getLiquidityLabel(outcome, outcomes);
            const poolMultiple = getPoolMultiple({ selectedPoolSats: outcome.poolSats, totalPoolSats: totalPool });
            const detailParts = [
              liquidityLabel,
              `${formatSats(outcome.poolSats)} sats`,
              totalPool - outcome.poolSats > 0 && poolMultiple ? `x${poolMultiple.toFixed(2)}` : null,
            ].filter(Boolean);
            return (
              <Button
                key={outcome.key}
                size="sm"
                variant="outline"
                disabled={!isBettable}
                onClick={() => setSelectedOutcome({ outcome, index })}
                className={`h-auto min-h-14 justify-between border-border/60 px-3 py-2 text-left font-mono ${isWinner ? "border-green-500/40 bg-green-500/10" : "bg-background/30 hover:bg-muted/40"}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
                  <span className="truncate text-[11px] font-bold uppercase tracking-wider">{outcome.label}</span>
                  {isWinner && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />}
                </span>
                <span className="max-w-[55%] truncate text-right text-[10px] text-muted-foreground shrink-0">
                  {detailParts.join(" · ")}
                </span>
              </Button>
            );
          })}

          {hiddenOutcomeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAllOutcomes((current) => !current)}
              className="h-9 justify-center border border-dashed border-border/50 bg-background/20 px-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:bg-muted/30"
            >
              {showAllOutcomes ? "Show fewer outcomes" : `Show ${hiddenOutcomeCount} more outcomes`}
            </Button>
          )}
        </div>
      )}

      {totalPool > 0 && <OutcomePoolBar outcomes={outcomes} />}

      {selectedOutcome && (
        <WeatherBetModal
          market={market}
          outcome={selectedOutcome.outcome}
          outcomeIndex={selectedOutcome.index}
          onClose={() => {
            setSelectedOutcome(null);
            onBetCreated?.();
          }}
        />
      )}
    </div>
  );
}

export function WeatherBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [bet, setBet] = useState<WeatherBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showLnInput, setShowLnInput] = useState(false);
  const [lnAddress, setLnAddress] = useState("");
  const [lnPaying, setLnPaying] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = async () => {
    const res = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
    if (res.ok) setBet(await res.json() as WeatherBetRecord);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }

        const data = await res.json() as WeatherBetRecord;
        setBet(data);

        if (
          ["pending", "paid"].includes(data.status) ||
          ((data.status === "won" || data.status === "refunded") && data.withdrawStatus === "unclaimed")
        ) {
          pollRef.current = setInterval(async () => {
            const refreshed = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
            if (!refreshed.ok) return;
            const next = await refreshed.json() as WeatherBetRecord;
            setBet(next);
            if (
              !["pending", "paid"].includes(next.status) &&
              !((next.status === "won" || next.status === "refunded") && next.withdrawStatus === "unclaimed")
            ) {
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
  const isRefund = bet.status === "refunded";
  const statusInfo = (() => {
    if (bet.status === "pending") return { label: "Waiting for payment...", color: "text-yellow-500", icon: Clock };
    if (bet.status === "paid") return { label: "Bet confirmed — waiting for market resolution", color: "text-blue-400", icon: CheckCircle2 };
    if (bet.status === "lost") return { label: "This outcome did not win", color: "text-red-500", icon: XCircle };
    if (bet.status === "expired") return { label: "Bet expired", color: "text-muted-foreground", icon: XCircle };
    if (bet.status === "refunded" && bet.withdrawStatus === "claimed") return { label: "Refund claimed", color: "text-green-500", icon: CheckCircle2 };
    if (bet.status === "refunded") return { label: "Refund ready to claim", color: "text-yellow-400", icon: Trophy };
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
      const res = await fetch(`${API_BASE}/api/weather/withdraw/${bet.withdrawToken}/pay-to-address`, {
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
    const text = `⚡ Just won ${sats} sats on Predictions With Sats on "${getBetMarketQuestion(bet.market)}" with outcome "${outcomeLabel}".`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = async () => {
    if (!bet.market) return;
    const sats = formatSats(bet.payoutSats ?? 0);
    const text = `⚡ Just won ${sats} sats on Predictions With Sats on "${getBetMarketQuestion(bet.market)}" with outcome "${outcomeLabel}".`;
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
        <span className="flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border border-cyan-400/40 bg-cyan-500/10 text-cyan-300">
          <Cloud className="h-3 w-3" /> {outcomeLabel}
        </span>
        <span className="text-muted-foreground text-xs">{formatSats(bet.amountSats)} sats</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{bet.market ? formatDate(bet.market.date) : ""}</span>
      </div>

      {bet.market && (
        <div className="mb-3 space-y-1">
          <p className="text-xs text-foreground font-semibold">{bet.market.city}</p>
          <p className="text-[10px] text-muted-foreground">{getBetMarketQuestion(bet.market)}</p>
          {winnerLabel && (
            <p className="text-[10px] text-muted-foreground">
              Winning outcome: <span className="text-foreground font-semibold">{winnerLabel}</span>
            </p>
          )}
        </div>
      )}

      {(bet.status === "won" || bet.status === "refunded") && bet.payoutSats && (
        <div className={`${isRefund ? "text-yellow-400" : "text-green-400"} text-sm font-bold mb-3`}>
          {isRefund
            ? `${formatSats(Number(bet.payoutSats))} sats refunded (0.5% fee)`
            : `+${formatSats(Number(bet.payoutSats))} sats won`}
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

      {(bet.status === "won" || bet.status === "refunded") && bet.withdrawStatus === "unclaimed" && bet.withdrawLnurl && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold uppercase tracking-wider animate-pulse">
            <Trophy className="h-3.5 w-3.5" />
            {isRefund ? "Refund ready — scan to claim" : "You won! Scan to claim"}
          </div>
          {isRefund && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              No opposing outcome received liquidity in this market, so your stake is being returned minus the 0.5% refund fee.
            </p>
          )}
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

export function Weather() {
  const [activeTab, setActiveTab] = useState<ContentTab>("markets");
  const [cityFilter, setCityFilter] = useState("all");
  const [marketPeriodFilter, setMarketPeriodFilter] = useState<MarketPeriodFilter>("today");
  const [betListVersion, setBetListVersion] = useState(0);

  const {
    data: markets,
    isLoading,
    error,
    refetch,
  } = useQuery<WeatherMarket[]>({
    queryKey: ["/api/weather/markets"],
    queryFn: fetchWeatherMarkets,
    refetchInterval: 60_000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const openMarkets = (markets ?? []).filter((market) => market.status === "open");
  const settledMarkets = (markets ?? []).filter((market) => market.status === "settled");
  const pendingResultMarkets = openMarkets.filter((market) => market.date < today);
  const bettableOpenMarkets = openMarkets.filter((market) => market.date >= today);
  const resultMarkets = [...pendingResultMarkets, ...settledMarkets].sort(
    (left, right) =>
      new Date(right.settledAt ?? `${right.date}T23:59:59Z`).getTime() -
      new Date(left.settledAt ?? `${left.date}T23:59:59Z`).getTime(),
  );
  const todayOpen = bettableOpenMarkets.filter((market) => market.date === today);
  const tomorrowOpen = bettableOpenMarkets.filter((market) => market.date === tomorrow);
  const laterOpen = bettableOpenMarkets.filter((market) => market.date > tomorrow);
  const citySourceMarkets = activeTab === "results"
    ? resultMarkets
    : (bettableOpenMarkets.length > 0 ? bettableOpenMarkets : resultMarkets);
  const cityOptions = getOrderedCityOptions(citySourceMarkets);
  const filterByCity = (items: WeatherMarket[]) => cityFilter === "all" ? items : items.filter((market) => market.city === cityFilter);
  const filteredResultMarkets = filterByCity(resultMarkets);
  const filteredTodayOpen = filterByCity(todayOpen);
  const filteredTomorrowOpen = filterByCity(tomorrowOpen);
  const marketSections = [
    { key: "today" as const, label: "Today", items: filteredTodayOpen, accentClass: "text-cyan-400" },
    { key: "tomorrow" as const, label: "Tomorrow", items: filteredTomorrowOpen, accentClass: "text-muted-foreground" },
  ];
  const visibleMarketSections = marketSections.filter((section) => section.key === marketPeriodFilter);
  const activeOpenMarkets = visibleMarketSections.flatMap((section) => section.items);
  const periodOptions = [
    { key: "today" as const, label: "Today", count: filteredTodayOpen.length },
    { key: "tomorrow" as const, label: "Tomorrow", count: filteredTomorrowOpen.length },
  ];
  const visiblePeriodOptions = periodOptions.filter((option) => option.count > 0);
  const weatherBetHashes = getWeatherBetHashes();
  void betListVersion;

  useEffect(() => {
    if (!cityOptions.includes(cityFilter)) {
      setCityFilter("all");
    }
  }, [cityFilter, cityOptions]);

  useEffect(() => {
    if (!visiblePeriodOptions.some((option) => option.key === marketPeriodFilter)) {
      setMarketPeriodFilter(visiblePeriodOptions[0]?.key ?? "today");
    }
  }, [marketPeriodFilter, visiblePeriodOptions]);

  return (
    <div className="max-w-4xl mx-auto space-y-0">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {cityOptions.map((city) => {
          const active = cityFilter === city;
          return (
            <button
              key={city}
              onClick={() => setCityFilter(city)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                active
                  ? "bg-cyan-400/20 text-cyan-300 border-cyan-400/50"
                  : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
              }`}
            >
              {city === "all" ? (
                <><Cloud className="h-3 w-3" /> All Cities</>
              ) : city}
            </button>
          );
        })}
      </div>

      <div className="flex gap-1 overflow-x-auto no-scrollbar pb-4">
        {visiblePeriodOptions.map((option) => {
          const active = marketPeriodFilter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setMarketPeriodFilter(option.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-mono font-semibold uppercase tracking-wider transition-colors ${
                active
                  ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-300"
                  : "border-border/40 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {option.label} ({option.count})
            </button>
          );
        })}
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
        <WeatherGuide onDone={() => { setActiveTab("markets"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      )}

      {activeTab === "myBets" && (
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Weather — My Bets</p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 text-emerald-400" />
              {weatherBetHashes.length} saved
            </span>
          </div>

          {weatherBetHashes.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="font-mono text-sm text-foreground">No saved weather bets yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bets placed in this browser for weather markets will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="card-stack">
              {weatherBetHashes.map((hash) => (
                <WeatherBetStatusCard
                  key={hash}
                  hash={hash}
                  onDismiss={() => {
                    removeWeatherBetHash(hash);
                    setBetListVersion((current) => current + 1);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "markets" && (
        <div className="card-stack">
          {error ? (
            <ErrorState
              title="FAILED TO LOAD WEATHER MARKETS"
              description={error instanceof Error ? error.message : "Unknown network error"}
              onRetry={() => void refetch()}
              className="h-auto min-h-40 py-8"
              cardClassName="border-red-400/20 bg-background/60"
            />
          ) : isLoading ? (
            <LoadingState label="LOADING WEATHER MARKETS..." className="h-40" spinnerClassName="text-cyan-400" />
          ) : (
            <>
              {activeOpenMarkets.length === 0 && filteredResultMarkets.length > 0 && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div className="space-y-2">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
                        No open markets for this filter right now
                      </p>
                      <Button variant="outline" size="sm" onClick={() => setActiveTab("results")}>
                        View all results
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {activeOpenMarkets.length === 0 && filteredResultMarkets.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <AlertCircle className="h-10 w-10" />
                  <p className="font-mono text-sm">No markets for this filter right now</p>
                </div>
              )}

              {visibleMarketSections.map((section) => (
                section.items.length === 0 ? (
                  <div key={section.key} className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                    <AlertCircle className="h-8 w-8" />
                    <p className="font-mono text-sm">No {section.label.toLowerCase()} markets for this filter right now</p>
                  </div>
                ) : (
                  <div key={section.key}>
                    <div className="card-stack">
                      {section.items.map((market) => (
                        <MarketCard key={market.id} market={market} onBetCreated={() => setBetListVersion((current) => current + 1)} />
                      ))}
                    </div>
                  </div>
                )
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === "results" && (
        <div className="card-stack">
          {filterByCity(resultMarkets).length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Cloud className="h-10 w-10" />
              <p className="font-mono text-sm">No recent results yet</p>
            </div>
          ) : (
            filterByCity(resultMarkets).map((market) => <MarketCard key={market.id} market={market} />)
          )}
        </div>
      )}
    </div>
  );
}
