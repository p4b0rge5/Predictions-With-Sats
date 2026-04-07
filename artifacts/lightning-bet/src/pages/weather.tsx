import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Cloud, CloudRain, Sun, Thermometer, Zap, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, AlertCircle, Copy,
  BookOpen, Wallet, CalendarDays, BarChart3, ShieldCheck, ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { getWeatherBetHashes, removeWeatherBetHash, saveWeatherBetHash } from "@/components/my-bet-widget";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "yes" | "no";
type ContentTab = "guide" | "my-bets" | "markets" | "results";

interface WeatherMarket {
  id: number;
  city: string;
  country: string;
  emoji: string;
  date: string;
  threshold: number;
  status: "open" | "settled";
  outcome: "yes" | "no" | null;
  actualTemp: number | null;
  totalYesSats: number;
  totalNoSats: number;
  settledAt: string | null;
}

interface WeatherBetResult {
  betId: number;
  paymentHash: string;
  paymentRequest: string;
  verifyUrl: string | null;
  amountSats: number;
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
// Constants
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const MIN_SATS = 546;
const APPROX_BTC_USD = 95_000;
const BTC_SATS = 100_000_000;

function usdToSats(usd: number): number {
  return Math.round((usd / APPROX_BTC_USD) * BTC_SATS);
}

function formatSats(n: number) {
  return new Intl.NumberFormat().format(n);
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

async function fetchWeatherMarkets(): Promise<WeatherMarket[]> {
  const res = await fetch(`${API_BASE}/api/weather/markets`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<WeatherMarket[]>;
}

// ---------------------------------------------------------------------------
// Weather Guide
// ---------------------------------------------------------------------------

const GUIDE_STEPS = [
  {
    icon: BookOpen,
    color: "text-cyan-400",
    bg: "bg-cyan-400/10 border-cyan-400/30",
    title: "How Weather Predictions Work",
    body: "Each day, markets open for major cities asking a simple question: will the maximum temperature reach (or exceed) a given threshold?\n\nVote YES or NO and pay with Bitcoin via the Lightning Network.",
  },
  {
    icon: Thermometer,
    color: "text-orange-400",
    bg: "bg-orange-400/10 border-orange-400/30",
    title: "What You're Predicting",
    body: "Each market shows: city, date, and threshold temperature in °C.\n\nExample: \"Will São Paulo reach 28°C on Apr 8?\"\n• YES — you think the max temp will be ≥ 28°C\n• NO — you think it will stay below 28°C",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    bg: "bg-blue-400/10 border-blue-400/30",
    title: "Pay with Lightning",
    body: "Choose a side, enter your amount, and scan the invoice QR code with any Lightning wallet (Phoenix, Alby, Wallet of Satoshi…). Minimum bet is 546 sats (~$0.50). No sign-up needed.",
  },
  {
    icon: CalendarDays,
    color: "text-green-400",
    bg: "bg-green-400/10 border-green-400/30",
    title: "Settlement",
    body: "Markets settle the day after the forecast date using real weather data from Open-Meteo (a public, independent weather service). The actual recorded max temperature is compared to the threshold — no manipulation possible.",
  },
  {
    icon: BarChart3,
    color: "text-purple-400",
    bg: "bg-purple-400/10 border-purple-400/30",
    title: "Payout",
    body: "All bets flow into a shared pool. After settlement, winners split the total pool proportionally to their stake, minus a 2% fee. Payouts arrive via Lightning — scan the withdrawal QR to claim your sats.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 border-emerald-400/30",
    title: "Fees & Rules",
    body: "2% house fee on every settlement.\n• If only one side has bets, the pool is kept by the house.\n• Markets are available for today and tomorrow.\n• Betting closes once the day ends (UTC midnight).",
  },
  {
    icon: ListChecks,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/30",
    title: "Cities & Thresholds",
    body: "Thresholds are set per city based on seasonal averages — designed so that both YES and NO outcomes are plausible. Currently available:\n🇧🇷 São Paulo · 🇺🇸 New York · 🇬🇧 London · 🌴 Miami · 🇯🇵 Tokyo · 🇦🇪 Dubai",
  },
];

function WeatherGuide({ onDone }: { onDone?: () => void }) {
  return (
    <div className="space-y-3 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-cyan-500 flex items-center justify-center shrink-0">
          <Cloud className="text-white w-4 h-4" />
        </div>
        <h2 className="text-base font-bold font-mono uppercase tracking-wider">Weather Betting Guide</h2>
      </div>
      {GUIDE_STEPS.map((step, i) => {
        const Icon = step.icon;
        return (
          <div key={i} className="flex gap-3 p-3 rounded-xl border border-border/40 bg-card/30">
            <div className={`mt-0.5 shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${step.bg}`}>
              <Icon className={`h-4 w-4 ${step.color}`} />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-bold font-mono uppercase tracking-wider text-foreground">{step.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{step.body}</p>
            </div>
          </div>
        );
      })}
      <button
        onClick={onDone}
        className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 font-mono font-bold text-sm uppercase tracking-wider hover:bg-yellow-400/20 transition-colors"
      >
        <Zap className="h-4 w-4 fill-yellow-400/30" />
        Start Betting
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pool Bar (2-way: YES / NO)
// ---------------------------------------------------------------------------

function PoolBar({ yesSats, noSats }: { yesSats: number; noSats: number }) {
  const total = yesSats + noSats;
  const pY = total > 0 ? (yesSats / total) * 100 : 50;
  const pN = total > 0 ? (noSats / total) * 100 : 50;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center font-mono text-xs mb-1">
        <span className="font-bold text-green-500">{pY.toFixed(1)}% YES</span>
        <span className="text-[10px] text-muted-foreground">Pool: {formatSats(total)} sats</span>
        <span className="font-bold text-red-500">{pN.toFixed(1)}% NO</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        <div className="bg-green-500 transition-all" style={{ width: `${pY}%` }} />
        <div className="bg-red-500 transition-all" style={{ width: `${pN}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bet Modal
// ---------------------------------------------------------------------------

function WeatherBetModal({
  market,
  direction,
  onClose,
}: {
  market: WeatherMarket;
  direction: Direction;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [amountUsd, setAmountUsd] = useState("1.00");
  const [invoice, setInvoice] = useState<WeatherBetResult | null>(null);
  const [webLnPaid, setWebLnPaid] = useState(false);
  const [copying, setCopying] = useState(false);

  const amountSats = usdToSats(parseFloat(amountUsd) || 0);
  const isValid = amountSats >= MIN_SATS && parseFloat(amountUsd) > 0;

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/weather/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: market.id, direction, amountUsd: parseFloat(amountUsd) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to create invoice");
      }
      return res.json() as Promise<WeatherBetResult>;
    },
    onSuccess: (data) => { setInvoice(data); saveWeatherBetHash(data.paymentHash); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleWebLn = async () => {
    if (!invoice || !window.webln) return;
    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.paymentRequest);
      setWebLnPaid(true);
      toast({ title: "Payment sent!", description: "Your weather bet is confirmed." });
    } catch {
      toast({ title: "WebLN failed", description: "Please scan the QR code instead.", variant: "destructive" });
    }
  };

  const copyInvoice = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.paymentRequest);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  const directionLabel = direction === "yes" ? "YES" : "NO";
  const directionColor = direction === "yes" ? "text-green-400" : "text-red-400";
  const directionBg = direction === "yes" ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30";

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm font-mono">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest flex items-center gap-2">
            <Cloud className="h-4 w-4 text-cyan-400" />
            Place Weather Bet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className={`rounded-lg border p-3 text-sm ${directionBg}`}>
            <p className="text-xs text-muted-foreground mb-1">{market.emoji} {market.city} · {formatDate(market.date)}</p>
            <p className="font-bold">
              Will max temp reach <span className="text-cyan-400">{market.threshold}°C</span>?
            </p>
            <p className={`font-bold mt-1 ${directionColor}`}>Your bet: {directionLabel}</p>
          </div>

          {!invoice ? (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground uppercase tracking-wider">Amount (USD)</label>
                <Input
                  type="number"
                  min="0.50"
                  step="0.50"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  className="font-mono text-sm"
                  placeholder="1.00"
                />
                <p className="text-[10px] text-muted-foreground">
                  ≈ {formatSats(amountSats)} sats · min 546 sats (~$0.50)
                </p>
              </div>
              <Button
                className="w-full"
                disabled={!isValid || generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? "Generating…" : "Generate Invoice"}
              </Button>
            </>
          ) : webLnPaid ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="text-sm font-bold text-green-400">Bet confirmed!</p>
              <p className="text-xs text-muted-foreground text-center">
                Check results on the day after {formatDate(market.date)}.
              </p>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center">
                <QRCodeSVG value={invoice.paymentRequest.toUpperCase()} size={200} className="rounded-lg" />
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Scan with any Lightning wallet · {formatSats(invoice.amountSats)} sats
              </p>
              <div className="flex gap-2">
                {window.webln && (
                  <Button size="sm" className="flex-1 text-xs" onClick={handleWebLn}>
                    <Zap className="h-3 w-3 mr-1 fill-yellow-400/30" /> Pay WebLN
                  </Button>
                )}
                <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={copyInvoice}>
                  <Copy className="h-3 w-3 mr-1" /> {copying ? "Copied!" : "Copy"}
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Market Card
// ---------------------------------------------------------------------------

function MarketCard({ market }: { market: WeatherMarket }) {
  const [betDirection, setBetDirection] = useState<Direction | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = market.date === today;
  const totalSats = market.totalYesSats + market.totalNoSats;
  const isSettled = market.status === "settled";

  const tempIcon = market.threshold >= 30 ? (
    <Sun className="h-4 w-4 text-orange-400" />
  ) : market.threshold >= 20 ? (
    <Cloud className="h-4 w-4 text-cyan-400" />
  ) : (
    <CloudRain className="h-4 w-4 text-blue-400" />
  );

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-lg leading-none">{market.emoji}</span>
            <span className="font-bold font-mono text-sm truncate">{market.city}</span>
            {isToday && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono border-cyan-400/40 text-cyan-400">TODAY</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{formatDate(market.date)}</p>
        </div>
        {isSettled ? (
          <div className="shrink-0 text-right">
            {market.outcome === "yes" ? (
              <span className="inline-flex items-center text-green-400 font-bold font-mono text-xs bg-green-400/10 px-2 py-0.5 rounded">
                <CheckCircle2 className="h-3 w-3 mr-1" /> YES
              </span>
            ) : (
              <span className="inline-flex items-center text-red-400 font-bold font-mono text-xs bg-red-400/10 px-2 py-0.5 rounded">
                <XCircle className="h-3 w-3 mr-1" /> NO
              </span>
            )}
          </div>
        ) : (
          <div className="shrink-0 flex items-center gap-1 text-xs font-mono text-muted-foreground">
            <Clock className="h-3 w-3" /> Open
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {tempIcon}
        <p className="text-sm font-mono">
          Will max temp reach{" "}
          <span className="font-bold text-cyan-400">{market.threshold}°C</span>?
        </p>
        {isSettled && market.actualTemp !== null && (
          <span className="ml-auto text-xs font-mono text-muted-foreground shrink-0">
            Actual: <span className="text-foreground font-bold">{market.actualTemp}°C</span>
          </span>
        )}
      </div>

      {/* Settlement timestamp — only on settled markets */}
      {isSettled && market.settledAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono border-t border-border/30 pt-2">
          <Clock className="h-3 w-3 shrink-0" />
          Resolved {format(new Date(market.settledAt), "MMM d, yyyy · HH:mm")} UTC
          {market.actualTemp !== null && (
            <span className="ml-auto">
              Actual max: <span className="text-foreground font-bold">{market.actualTemp}°C</span>
            </span>
          )}
        </div>
      )}

      {!isSettled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              onClick={() => setBetDirection("yes")}
              className="h-10 font-mono font-bold text-xs bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/60"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> BET YES
            </Button>
            <Button
              size="sm"
              onClick={() => setBetDirection("no")}
              className="h-10 font-mono font-bold text-xs bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/60"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" /> BET NO
            </Button>
          </div>
          {/* Pool bar — below buttons, matching Bitcoin pattern */}
          <PoolBar yesSats={market.totalYesSats} noSats={market.totalNoSats} />
        </>
      )}

      {betDirection && (
        <WeatherBetModal market={market} direction={betDirection} onClose={() => setBetDirection(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weather cities subcategory chips
// ---------------------------------------------------------------------------

const CITY_KEYS = ["all", "São Paulo", "New York", "London", "Miami", "Tokyo", "Dubai"] as const;
type CityFilter = (typeof CITY_KEYS)[number];

// ---------------------------------------------------------------------------
// My Bets tab — Weather
// ---------------------------------------------------------------------------

interface WeatherBetRecord {
  id: number;
  paymentHash: string;
  direction: string;
  amountSats: number;
  status: string;
  payoutSats: number | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  market: { city: string; date: string; threshold: number; status: string; outcome: string | null; actualTemp: number | null } | null;
}

function WeatherBetStatusBadge({ status }: { status: string }) {
  if (status === "pending")  return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[9px]">PENDING</Badge>;
  if (status === "paid")     return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px]">PLACED</Badge>;
  if (status === "won")      return <Badge className="bg-yellow-400/20 text-yellow-300 border-yellow-400/30 text-[9px]">WON 🏆</Badge>;
  if (status === "lost")     return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">LOST</Badge>;
  if (status === "expired")  return <Badge className="bg-muted text-muted-foreground text-[9px]">EXPIRED</Badge>;
  return <Badge className="text-[9px]">{status.toUpperCase()}</Badge>;
}

function WeatherBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const [bet, setBet] = useState<WeatherBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/weather/bets/${hash}`)
      .then((r) => { if (!r.ok) { setNotFound(true); return null; } return r.json(); })
      .then((d) => { if (d) setBet(d as WeatherBetRecord); })
      .catch(() => setNotFound(true));
  }, [hash]);

  if (notFound) return null;
  if (!bet) return <div className="h-16 rounded-xl border border-border/40 bg-card/30 animate-pulse" />;

  const dirColor  = bet.direction === "yes" ? "text-green-400" : "text-red-400";
  const dirLabel  = bet.direction === "yes" ? "YES" : "NO";

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-2 font-mono">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${dirColor}`}>{dirLabel}</span>
          <WeatherBetStatusBadge status={bet.status} />
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
      {bet.market && (
        <>
          <p className="text-xs text-foreground">{bet.market.city} · {format(new Date(bet.market.date + "T12:00:00"), "MMM d")}</p>
          <p className="text-[10px] text-muted-foreground">Will max temp reach {bet.market.threshold}°C?</p>
        </>
      )}
      <p className="text-[10px] text-muted-foreground">{bet.amountSats.toLocaleString()} sats wagered</p>
      {bet.status === "won" && bet.payoutSats && (
        <div className="border-t border-border/30 pt-3 space-y-2 flex flex-col items-center">
          <p className="text-xs text-yellow-400 font-bold">PAYOUT: {bet.payoutSats.toLocaleString()} sats</p>
          {bet.withdrawLnurl && (
            <>
              <div className="bg-white p-2 rounded-lg"><QRCodeSVG value={bet.withdrawLnurl} size={120} /></div>
              <p className="text-[10px] text-muted-foreground text-center">Scan to withdraw via Lightning</p>
            </>
          )}
          {!bet.withdrawLnurl && bet.withdrawStatus === "claimed" && (
            <p className="text-[10px] text-green-400">Winnings claimed ✓</p>
          )}
        </div>
      )}
    </div>
  );
}

function WeatherMyBetsTab({ hashes, onDismiss }: { hashes: string[]; onDismiss: (h: string) => void }) {
  if (hashes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <Cloud className="h-10 w-10" />
        <p className="font-mono text-sm">No weather bets yet</p>
        <p className="font-mono text-xs text-center opacity-60">Bets you place on weather markets will appear here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {hashes.map((h) => (
        <WeatherBetStatusCard key={h} hash={h} onDismiss={() => onDismiss(h)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Weather Page
// ---------------------------------------------------------------------------

export function Weather() {
  const [activeTab, setActiveTab] = useState<ContentTab>("markets");
  const [cityFilter, setCityFilter] = useState<CityFilter>("all");
  const [betHashes, setBetHashes] = useState<string[]>([]);

  useEffect(() => { setBetHashes(getWeatherBetHashes()); }, []);

  const { data: markets, isLoading } = useQuery<WeatherMarket[]>({
    queryKey: ["/api/weather/markets"],
    queryFn: fetchWeatherMarkets,
    refetchInterval: 60_000,
  });

  const openMarkets    = (markets ?? []).filter((m) => m.status === "open");
  const settledMarkets = (markets ?? []).filter((m) => m.status === "settled");

  const filterByCity = (list: WeatherMarket[]) =>
    cityFilter === "all" ? list : list.filter((m) => m.city === cityFilter);

  return (
    <div className="max-w-3xl mx-auto space-y-0">

      {/* City chips (subcategory) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {CITY_KEYS.map((city) => {
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

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-4">
        {([
          { key: "markets",  label: "Upcoming" },
          { key: "guide",    label: "Guide" },
          { key: "my-bets",  label: "My Bets" },
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

      {activeTab === "guide" && (
        <WeatherGuide onDone={() => { setActiveTab("markets"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
      )}

      {activeTab === "my-bets" && (
        <WeatherMyBetsTab hashes={betHashes} onDismiss={(h) => { removeWeatherBetHash(h); setBetHashes(getWeatherBetHashes()); }} />
      )}

      {activeTab === "markets" && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan-400 border-t-transparent" />
            </div>
          ) : filterByCity(openMarkets).length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <AlertCircle className="h-10 w-10" />
              <p className="font-mono text-sm">No open markets right now</p>
            </div>
          ) : (
            filterByCity(openMarkets).map((m) => <MarketCard key={m.id} market={m} />)
          )}
        </div>
      )}

      {activeTab === "results" && (
        <div className="space-y-3">
          {filterByCity(settledMarkets).length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Cloud className="h-10 w-10" />
              <p className="font-mono text-sm">No settled markets yet</p>
            </div>
          ) : (
            filterByCity(settledMarkets).map((m) => <MarketCard key={m.id} market={m} />)
          )}
        </div>
      )}

    </div>
  );
}
