import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Cloud, CloudRain, Sun, Thermometer, Zap, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, AlertCircle, Copy,
  BookOpen, Wallet, CalendarDays, BarChart3, ShieldCheck, ListChecks,
  X, Share2, Gift, Loader2, Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { getWeatherBetHashes, removeWeatherBetHash, saveWeatherBetHash } from "@/components/my-bet-widget";
import { GuidePager } from "@/components/guide-pager";

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

interface CityTemp {
  key: string;
  name: string;
  emoji: string;
  threshold: number;
  currentTemp: number | null;
  todayMax: number | null;
  tomorrowMax: number | null;
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
  return new Intl.NumberFormat("en-US").format(n);
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
    iconBg: "bg-cyan-400/15 border-cyan-400/40",
    cardTint: "bg-cyan-400/5",
    cardBorder: "border-cyan-400/30",
    title: "How Weather Predictions Work",
    body: "Each day, markets open for major cities asking a simple question: will the maximum temperature reach (or exceed) a given threshold?\n\nVote YES or NO and pay with Bitcoin via the Lightning Network.",
  },
  {
    icon: Thermometer,
    color: "text-orange-400",
    iconBg: "bg-orange-400/15 border-orange-400/40",
    cardTint: "bg-orange-400/5",
    cardBorder: "border-orange-400/30",
    title: "What You're Predicting",
    body: "Each market shows: city, date, and threshold temperature in °C.\n\nExample: \"Will São Paulo reach 28°C on Apr 8?\"\n• YES — you think the max temp will be ≥ 28°C\n• NO — you think it will stay below 28°C",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "Pay with Lightning",
    body: "Choose a side, enter your amount, and scan the invoice QR code with any Lightning wallet (Phoenix, Alby, Wallet of Satoshi…). Minimum bet is $0.50 USD. No sign-up needed.",
  },
  {
    icon: CalendarDays,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Settlement",
    body: "Markets settle the day after the forecast date using real weather data from Open-Meteo (a public, independent weather service). The actual recorded max temperature is compared to the threshold — no manipulation possible.",
  },
  {
    icon: BarChart3,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Payout",
    body: "All bets flow into a shared pool. After settlement, winners split the total pool proportionally to their stake, minus a 2% fee. Payouts arrive via Lightning — scan the withdrawal QR to claim your sats.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Fees & Rules",
    body: "2% house fee on every settlement.\n• If only one side has bets, the pool is kept by the house.\n• Markets are available for today and tomorrow.\n• Betting closes once the day ends (UTC midnight).",
  },
  {
    icon: ListChecks,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Cities & Thresholds",
    body: "Thresholds are set per city based on seasonal averages — designed so that both YES and NO outcomes are plausible. Currently available:\n🇧🇷 São Paulo · 🇺🇸 New York · 🇬🇧 London · 🌴 Miami · 🇯🇵 Tokyo · 🇦🇪 Dubai",
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

type InputMode = "sats" | "usd";
const SATS_PRESETS_W = [546, 1000, 5000, 10000];
const USD_PRESETS_W  = [0.5, 1, 5, 10];

function WeatherAmountToggle({ mode, onChange }: { mode: InputMode; onChange: (m: InputMode) => void }) {
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
  const [inputMode, setInputMode] = useState<InputMode>("usd");
  const [rawAmount, setRawAmount] = useState("0.5");
  const [invoice, setInvoice] = useState<WeatherBetResult | null>(null);
  const [betPaid, setBetPaid] = useState(false);
  const [copying, setCopying] = useState(false);
  const [btcPrice, setBtcPrice] = useState(APPROX_BTC_USD);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [showPreimage, setShowPreimage] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setWeblnAvailable(typeof window.webln !== "undefined"); }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/market/current?asset=btc`)
      .then((r) => r.json())
      .then((d: { btcPriceUsd?: number }) => { if (d.btcPriceUsd && d.btcPriceUsd > 0) setBtcPrice(d.btcPriceUsd); })
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
        if (data.status === "paid" || data.status === "won") {
          setBetPaid(true);
          clearInterval(pollRef.current!);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [invoice?.paymentHash, betPaid]);

  const amountSats = inputMode === "sats"
    ? (parseInt(rawAmount, 10) || 0)
    : Math.round((parseFloat(rawAmount) || 0) / btcPrice * BTC_SATS);
  const amountUsd = inputMode === "usd"
    ? (parseFloat(rawAmount) || 0)
    : (amountSats / BTC_SATS * btcPrice);
  const isValid = amountUsd >= 0.50;

  const handleModeChange = (m: InputMode) => {
    setInputMode(m);
    setRawAmount(m === "sats" ? "1000" : "0.5");
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/weather/bets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: market.id, direction, amountUsd }),
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
      setBetPaid(true);
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

  const directionLabel = direction === "yes" ? "YES" : "NO";
  const directionColor = direction === "yes" ? "text-green-400" : "text-red-400";
  const directionBg = direction === "yes" ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30";

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
          <div className={`rounded-lg border p-3 text-sm ${directionBg}`}>
            <p className="text-xs text-muted-foreground mb-1">{market.emoji} {market.city} · {formatDate(market.date)}</p>
            <p className="font-bold">
              Will max temp reach <span className="text-cyan-400">{market.threshold}°C</span>?
            </p>
            <p className={`font-bold mt-1 ${directionColor}`}>Your bet: {directionLabel}</p>
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
                    <Input type="number" min="0" step="any"
                      value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                      className="pl-8 font-mono text-xl font-bold h-12 bg-card/50" placeholder="1.00" autoFocus />
                  </div>
                ) : (
                  <Input type="number" min="1" step="1"
                    value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                    className="font-mono text-xl font-bold h-12 bg-card/50" autoFocus />
                )}
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Min: $0.50 USD</span>
                  {inputMode === "sats"
                    ? <span>≈ ${amountUsd.toFixed(2)} USD</span>
                    : <span>≈ {formatSats(amountSats)} sats</span>
                  }
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {inputMode === "sats"
                  ? SATS_PRESETS_W.map((v) => (
                      <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                        className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                        {v >= 1000 ? `${v / 1000}k` : v}
                      </button>
                    ))
                  : USD_PRESETS_W.map((v) => (
                      <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                        className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                        ${v}
                      </button>
                    ))
                }
              </div>
              <Button
                className={`w-full h-12 text-base font-bold uppercase tracking-wider text-white ${direction === "yes" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}
                disabled={!isValid || generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? "Generating…" : "Generate Invoice"}
              </Button>
            </>
          ) : betPaid ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-400" />
              <p className="text-sm font-bold text-green-400 uppercase tracking-wider">Bet Confirmed!</p>
              <p className="text-xs text-muted-foreground text-center">
                Check results on the day after {formatDate(market.date)}.
              </p>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          ) : (
            <div className="pt-1 space-y-3">
              <div className="text-center">
                <p className="text-xl font-bold text-yellow-400">Pay {formatSats(invoice.amountSats)} sats</p>
                <p className={`text-xs mt-0.5 ${directionColor}`}>
                  {directionLabel} · {market.city} · {formatDate(market.date)}
                </p>
              </div>
              <div className="flex justify-center">
                <div className="bg-white p-2.5 rounded-xl shadow-lg cursor-pointer relative group" onClick={copyInvoice}>
                  <QRCodeSVG value={invoice.paymentRequest} size={180} level="M" includeMargin={false} />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                    <Copy className="h-8 w-8 text-white" />
                  </div>
                </div>
              </div>
              <button type="button" onClick={copyInvoice}
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden">
                <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">{invoice.paymentRequest.slice(0, 30)}…</span>
                <span className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-bold uppercase tracking-wider">
                  <Copy className="h-3.5 w-3.5" /> {copying ? "Copied!" : "Copy"}
                </span>
              </button>
              <div className="flex items-center justify-center gap-2 text-yellow-500 text-sm animate-pulse uppercase tracking-wider font-bold">
                <Clock className="h-4 w-4 shrink-0" /> Waiting for payment…
              </div>
              {weblnAvailable && (
                <Button onClick={handleWebLn}
                  className="w-full h-10 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black text-sm">
                  <Zap className="h-4 w-4 mr-2" />
                  Pay with WebLN
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Mini temperature bar — shown inside each individual market card
// ---------------------------------------------------------------------------

function MiniTempBar({
  temp,
  threshold,
  currentTemp,
}: {
  temp: number;
  threshold: number;
  currentTemp?: number | null;
}) {
  const isAbove = temp >= threshold;
  const isClose = !isAbove && temp >= threshold - 2;
  const low  = Math.min(temp, threshold) - 4;
  const high = Math.max(temp, threshold) + 4;
  const range = high - low;
  const tempPct   = Math.min(100, Math.max(2, ((temp - low) / range) * 100));
  const threshPct = Math.min(99, Math.max(1, ((threshold - low) / range) * 100));
  const barColor  = isAbove ? "bg-green-500/70" : isClose ? "bg-amber-500/70" : "bg-red-500/60";
  const textColor = isAbove ? "text-green-400"  : isClose ? "text-amber-400"  : "text-red-400";

  // Position of current temp indicator on the bar (if available)
  const currentPct = currentTemp !== null && currentTemp !== undefined
    ? Math.min(99, Math.max(1, ((currentTemp - low) / range) * 100))
    : null;

  return (
    <div className="space-y-1.5 border-t border-border/30 pt-2">
      {/* Row 1: labels */}
      <div className="flex items-center justify-between text-[10px] font-mono gap-2">
        <span className="flex items-center gap-1 text-muted-foreground shrink-0">
          <Thermometer className="h-3 w-3" /> Forecast max today
        </span>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {currentTemp !== null && currentTemp !== undefined && (
            <span className="text-cyan-400 font-medium">
              Now {currentTemp.toFixed(1)}°C
            </span>
          )}
          <span className={`font-bold ${textColor}`}>
            Max {temp.toFixed(1)}°C
            <span className="text-muted-foreground font-normal"> / target {threshold}°C</span>
          </span>
        </div>
      </div>
      {/* Row 2: bar */}
      <div className="relative h-3 bg-muted/30 rounded-sm overflow-hidden">
        <div className={`h-full rounded-sm transition-all duration-500 ${barColor}`} style={{ width: `${tempPct}%` }} />
        {/* Target threshold marker */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-yellow-400/80 z-10" style={{ left: `${threshPct}%` }} />
        {/* Current temp marker */}
        {currentPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 z-20"
            style={{ left: `${currentPct}%` }}
            title={`Now: ${currentTemp?.toFixed(1)}°C`}
          />
        )}
      </div>
      {/* Row 3: legend */}
      <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
        {currentTemp !== null && currentTemp !== undefined && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-cyan-400" /> Now
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-yellow-400/80" /> Target
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown hook — updates every second
// ---------------------------------------------------------------------------

function useCountdown(deadlineIso: string): { label: string; urgent: boolean; critical: boolean } {
  const deadline = useMemo(() => new Date(deadlineIso).getTime(), [deadlineIso]);
  const [remaining, setRemaining] = useState(() => deadline - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemaining(deadline - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (remaining <= 0) return { label: "Closing", urgent: true, critical: true };

  const totalSecs = Math.floor(remaining / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;

  let label: string;
  if (h > 0) label = `${h}h ${m}m`;
  else if (m > 0) label = `${m}m ${String(s).padStart(2, "0")}s`;
  else label = `${s}s`;

  return {
    label,
    urgent: remaining < 3 * 60 * 60 * 1000,   // < 3h
    critical: remaining < 60 * 60 * 1000,       // < 1h
  };
}

function MarketCard({
  market,
  cityTemp,
  onBetCreated,
}: {
  market: WeatherMarket;
  cityTemp?: CityTemp;
  onBetCreated?: () => void;
}) {
  const [betDirection, setBetDirection] = useState<Direction | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = market.date === today;
  // Deadline = end of market date at 23:59:59 UTC
  const deadline = `${market.date}T23:59:59Z`;
  const countdown = useCountdown(deadline);
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
    <div className="rounded-xl border bg-cyan-500/15 border-cyan-500/35 p-4 space-y-3">
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
          <div className={`shrink-0 flex items-center gap-1 text-xs font-mono font-bold ${
            countdown.critical
              ? "text-red-400"
              : countdown.urgent
              ? "text-amber-400"
              : "text-muted-foreground"
          }`}>
            <Clock className="h-3 w-3" />
            {countdown.label}
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

      {/* Mini forecast bar — only for open today markets with available data */}
      {!isSettled && isToday && cityTemp?.todayMax !== null && cityTemp?.todayMax !== undefined && (
        <MiniTempBar
          temp={cityTemp.todayMax}
          threshold={market.threshold}
          currentTemp={cityTemp.currentTemp}
        />
      )}

      {/* Current temp chip — for open tomorrow markets (no bar, just current conditions) */}
      {!isSettled && !isToday && cityTemp?.currentTemp !== null && cityTemp?.currentTemp !== undefined && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono border-t border-border/30 pt-2 text-muted-foreground">
          <Thermometer className="h-3 w-3 text-cyan-400" />
          <span>Current conditions:</span>
          <span className="text-cyan-400 font-bold">{cityTemp.currentTemp.toFixed(1)}°C</span>
        </div>
      )}

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
              className="h-11 font-mono font-bold text-[11px] bg-green-500/10 text-green-400 border border-green-500/40 hover:bg-green-500/20 hover:border-green-500 transition-all"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> BET YES
            </Button>
            <Button
              size="sm"
              onClick={() => setBetDirection("no")}
              className="h-11 font-mono font-bold text-[11px] bg-red-500/10 text-red-400 border border-red-500/40 hover:bg-red-500/20 hover:border-red-500 transition-all"
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" /> BET NO
            </Button>
          </div>
          {/* Pool bar — below buttons, matching Bitcoin pattern */}
          <PoolBar yesSats={market.totalYesSats} noSats={market.totalNoSats} />
        </>
      )}

      {betDirection && (
        <WeatherBetModal market={market} direction={betDirection} onClose={() => { setBetDirection(null); onBetCreated?.(); }} />
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
  withdrawToken: string | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  market: {
    city: string;
    date: string;
    threshold: number;
    status: string;
    outcome: string | null;
    actualTemp: number | null;
  } | null;
}

const WEATHER_DIR_STYLES = {
  yes: { text: "text-green-400", bg: "bg-green-500/20 border-green-500/50", icon: "↑", label: "YES" },
  no:  { text: "text-red-400",   bg: "bg-red-500/20 border-red-500/50",    icon: "↓", label: "NO"  },
};

function WeatherBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const { toast } = useToast();
  const [bet, setBet] = useState<WeatherBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showLnInput, setShowLnInput] = useState(false);
  const [lnAddress, setLnAddress] = useState("");
  const [lnPaying, setLnPaying] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = async () => {
    const r = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
    if (r.ok) setBet(await r.json() as WeatherBetRecord);
  };

  const shouldPoll = (d: WeatherBetRecord) =>
    d.status === "pending" ||
    d.status === "paid" ||
    (d.status === "won" && d.withdrawStatus === "unclaimed");

  const pollInterval = (d: WeatherBetRecord) =>
    d.status === "pending" ? 3000
    : (d.status === "won" && d.withdrawStatus === "unclaimed") ? 10000
    : 60000;

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
        if (!res.ok) { setNotFound(true); return; }
        const data = await res.json() as WeatherBetRecord;
        setBet(data);
        if (shouldPoll(data)) {
          pollRef.current = setInterval(async () => {
            const r = await fetch(`${API_BASE}/api/weather/bets/${hash}`);
            if (!r.ok) return;
            const d = await r.json() as WeatherBetRecord;
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

  const dir = bet.direction === "yes" ? "yes" : "no";
  const dirStyle = WEATHER_DIR_STYLES[dir];

  // Market date — deadline = end of day UTC
  const marketDate = bet.market ? new Date(bet.market.date + "T23:59:59Z") : null;
  const marketDateStr = bet.market ? format(new Date(bet.market.date + "T12:00:00Z"), "MMM d") : null;

  // Time until settlement
  const timeLeftLabel = (() => {
    if (!marketDate || bet.market?.status !== "open") return null;
    const diff = marketDate.getTime() - Date.now();
    if (diff <= 0) return "Settling today...";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `Settles in ${h}h ${m}m` : `Settles in ${m}m`;
  })();

  const statusInfo = (() => {
    if (bet.status === "pending")
      return { label: "Waiting for payment...", color: "text-yellow-500", pulse: true, icon: Clock };
    if (bet.status === "paid" && timeLeftLabel)
      return { label: `Bet confirmed — ${timeLeftLabel.toLowerCase()}`, color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "paid")
      return { label: "Bet confirmed — waiting for result...", color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "lost")
      return { label: "Better luck next time!", color: "text-red-500", pulse: false, icon: XCircle };
    if (bet.status === "expired")
      return { label: "Bet expired", color: "text-muted-foreground", pulse: false, icon: XCircle };
    if (bet.status === "won" && bet.withdrawStatus === "claimed")
      return { label: "Prize claimed! 🎉", color: "text-green-500", pulse: false, icon: CheckCircle2 };
    return null;
  })();

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
        `${window.location.origin}/api/weather/withdraw/${bet.withdrawToken}/pay-to-address`,
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
    const pick = dir === "yes" ? "YES" : "NO";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Predicted ${pick} on "${bet.market.city} will reach ${bet.market.threshold}°C" correctly. Try it at pwsats.com — no accounts, instant Lightning payouts.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = () => {
    if (!bet || !bet.market) return;
    const sats = new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0);
    const pick = dir === "yes" ? "YES" : "NO";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Predicted ${pick} on "${bet.market.city} will reach ${bet.market.threshold}°C" correctly. No accounts — bet and claim entirely via Lightning Network. pwsats.com #Bitcoin #Lightning #Weather`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied for Nostr!", description: "Paste it in your Nostr client.", duration: 3000 });
  };

  return (
    <div className={`rounded-xl border ${dirStyle.bg} p-4 font-mono relative`}>
      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header row */}
      <div className="flex items-center gap-2 mb-3 pr-6">
        <span className={`flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border ${dirStyle.bg} ${dirStyle.text}`}>
          {dirStyle.icon} {dirStyle.label}
        </span>
        <span className="text-muted-foreground text-xs">
          {new Intl.NumberFormat("en-US").format(bet.amountSats)} sats
        </span>
        {marketDateStr && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {marketDateStr}
          </span>
        )}
      </div>

      {/* Market info */}
      {bet.market && (
        <div className="mb-3 space-y-1">
          <p className="text-xs text-foreground font-semibold">
            {bet.market.city}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Will max temp reach {bet.market.threshold}°C?
          </p>
          {bet.market.actualTemp !== null && (
            <p className="text-[10px] text-muted-foreground">
              Actual max temp:{" "}
              <span className={`font-semibold ${
                (dir === "yes" && bet.market.actualTemp >= bet.market.threshold) ||
                (dir === "no"  && bet.market.actualTemp < bet.market.threshold)
                  ? "text-green-400" : "text-red-400"
              }`}>
                {bet.market.actualTemp}°C
              </span>
              {bet.market.outcome && (
                <span className="ml-1 opacity-60 capitalize">· {bet.market.outcome}</span>
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

      {/* Status */}
      {statusInfo && (
        <div className={`flex items-center gap-2 text-xs ${statusInfo.color} ${statusInfo.pulse ? "animate-pulse" : ""} mb-1`}>
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

      {/* CLAIM WINNINGS — QR + LNURL flow */}
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
      <p className="font-mono text-xs text-muted-foreground flex items-center gap-2">
        <Clock className="h-3.5 w-3.5" />
        MY BETS ({hashes.length})
      </p>
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
  useEffect(() => { if (activeTab === "my-bets") setBetHashes(getWeatherBetHashes()); }, [activeTab]);

  const refreshBetHashes = () => setBetHashes(getWeatherBetHashes());

  const { data: markets, isLoading } = useQuery<WeatherMarket[]>({
    queryKey: ["/api/weather/markets"],
    queryFn: fetchWeatherMarkets,
    refetchInterval: 60_000,
  });

  const { data: cityTemps } = useQuery<CityTemp[]>({
    queryKey: ["/api/weather/temps"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/weather/temps`);
      if (!res.ok) throw new Error("Failed to fetch temps");
      return res.json() as Promise<CityTemp[]>;
    },
    staleTime: 25 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });

  // Build city name → CityTemp lookup
  const tempByCity = Object.fromEntries(
    (cityTemps ?? []).map((t) => [t.name, t])
  );

  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const openMarkets    = (markets ?? []).filter((m) => m.status === "open");
  const settledMarkets = (markets ?? []).filter((m) => m.status === "settled");

  // Split open markets into today vs tomorrow to avoid looking like duplicates
  const todayOpen    = openMarkets.filter((m) => m.date === today);
  const tomorrowOpen = openMarkets.filter((m) => m.date === tomorrow);

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
          { key: "markets",  label: "Markets" },
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
            <>
              {/* Today's markets */}
              {filterByCity(todayOpen).length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-400">Today</span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  {filterByCity(todayOpen).map((m) => (
                    <MarketCard key={m.id} market={m} cityTemp={tempByCity[m.city]} onBetCreated={refreshBetHashes} />
                  ))}
                </>
              )}
              {/* Tomorrow's markets */}
              {filterByCity(tomorrowOpen).length > 0 && (
                <>
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">Tomorrow</span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  {filterByCity(tomorrowOpen).map((m) => (
                    <MarketCard key={m.id} market={m} onBetCreated={refreshBetHashes} />
                  ))}
                </>
              )}
            </>
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
