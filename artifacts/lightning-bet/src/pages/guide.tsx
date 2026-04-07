import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Zap, Clock, ArrowUpCircle, ArrowDownCircle, QrCode,
  TrendingUp, Trophy, ShieldCheck, ChevronLeft, ChevronRight,
  X, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    n: 1,
    icon: Zap,
    iconColor: "text-yellow-400",
    iconBg: "bg-yellow-400/10 border-yellow-400/30",
    title: "Welcome to Prediction With Sats",
    subtitle: "What is this?",
    body: "A real-time Bitcoin price prediction game. Every 5 minutes, predict whether BTC will go UP or DOWN. Bet any amount in satoshis via the Lightning Network. Winners split the pool — no accounts, no sign-up required.",
    visual: <WelcomeVisual />,
  },
  {
    n: 2,
    icon: Clock,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-400/10 border-blue-400/30",
    title: "5-Minute Windows",
    subtitle: "How timing works",
    body: "Each window opens exactly on a UTC minute mark (:00, :05, :10 ... :55) and closes 5 minutes later. A live countdown shows how much time remains. The last 30 seconds are locked — no new bets are accepted.",
    visual: <WindowVisual />,
  },
  {
    n: 3,
    icon: ArrowUpCircle,
    iconColor: "text-green-400",
    iconBg: "bg-green-400/10 border-green-400/30",
    title: "Choose a Direction",
    subtitle: "Step 1 of betting",
    body: "Tap BET UP if you think BTC will be higher at window close, or BET DOWN if you think it will be lower. The pool bar shows how much is already on each side — a lopsided pool means bigger potential gains for the minority.",
    visual: <DirectionVisual />,
  },
  {
    n: 4,
    icon: DollarSign,
    iconColor: "text-orange-400",
    iconBg: "bg-orange-400/10 border-orange-400/30",
    title: "Enter Your Amount",
    subtitle: "Step 2 of betting",
    body: "Enter how much you want to bet in USD (minimum $0.50). The server converts it to satoshis at the live BTC price. A Lightning invoice is generated instantly — you see the exact sats amount before confirming.",
    visual: <AmountVisual />,
  },
  {
    n: 5,
    icon: QrCode,
    iconColor: "text-purple-400",
    iconBg: "bg-purple-400/10 border-purple-400/30",
    title: "Pay with Lightning",
    subtitle: "Step 3 of betting",
    body: "Scan the QR code with any Lightning wallet (Phoenix, Breez, Alby, Zeus...). If your browser has a Lightning extension, tap Pay with WebLN for one-click payment. You can also copy the invoice string manually. Payment is confirmed automatically.",
    visual: <PayVisual />,
  },
  {
    n: 6,
    icon: TrendingUp,
    iconColor: "text-cyan-400",
    iconBg: "bg-cyan-400/10 border-cyan-400/30",
    title: "Watch the Result",
    subtitle: "Settlement",
    body: "When the window closes, the displayed price freezes. After a 20-second buffer the final BTC price is fetched and compared to the opening price. The outcome is UP, DOWN, DRAW, or REFUND (when no opposing bets existed). Your bet card on the home page updates automatically.",
    visual: <ResultVisual />,
  },
  {
    n: 7,
    icon: Trophy,
    iconColor: "text-yellow-400",
    iconBg: "bg-yellow-400/10 border-yellow-400/30",
    title: "Claim Your Winnings",
    subtitle: "Getting paid",
    body: "If you won, a QR code appears on your bet card. Scan it with any Lightning wallet to receive your sats via LNURL-Withdraw — your wallet generates an invoice and we pay it automatically. Prefer not to scan? Expand 'Send to my Lightning address' and type your address (e.g. you@wallet.com) — we resolve it and push the payment directly to you. Payouts expire after 30 days.",
    visual: <WinVisual />,
  },
  {
    n: 8,
    icon: ShieldCheck,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-400/10 border-emerald-400/30",
    title: "Fees & Edge Cases",
    subtitle: "The fine print",
    body: "A 2% platform fee applies to every settlement. DRAW (price unchanged): all bettors share 98% of the combined pool proportionally. No opposing bets: your stake is fully refunded at 98%. Unpaid invoices expire when the window closes. Unclaimed payouts expire 30 days after the bet was placed.",
    visual: <FeesVisual />,
  },
];

interface GuideProps {
  onDone?: () => void;
}

export function Guide({ onDone }: GuideProps = {}) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const total = STEPS.length;

  const handleDone = useCallback(() => {
    if (onDone) onDone(); else navigate("/");
  }, [onDone, navigate]);

  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const next = useCallback(() => {
    if (step < total - 1) setStep((s) => s + 1);
    else handleDone();
  }, [step, total, handleDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") prev();
      if (e.key === "Escape") handleDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, handleDone]);

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Close button */}
      <div className="flex items-center justify-between mb-6">
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
          How It Works
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={handleDone}
          aria-label="Close guide"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Step dots progress */}
      <div className="flex items-center justify-center gap-1.5 mb-8">
        {STEPS.map((s, i) => (
          <button
            key={s.n}
            onClick={() => setStep(i)}
            className={`transition-all duration-200 rounded-full ${
              i === step
                ? "w-6 h-2 bg-yellow-400"
                : i < step
                ? "w-2 h-2 bg-yellow-400/40"
                : "w-2 h-2 bg-border"
            }`}
            aria-label={`Go to step ${s.n}`}
          />
        ))}
      </div>

      {/* Main card */}
      <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-yellow-400/60 to-transparent" />

        <div className="p-6 sm:p-8">
          {/* Step counter + icon row */}
          <div className="flex items-start gap-4 mb-6">
            <div className={`shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center ${current.iconBg}`}>
              <Icon className={`h-6 w-6 ${current.iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                Step {current.n} of {total} — {current.subtitle}
              </p>
              <h2 className="text-xl sm:text-2xl font-mono font-bold tracking-tight leading-tight">
                {current.title}
              </h2>
            </div>
          </div>

          {/* Body text */}
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed font-mono mb-6">
            {current.body}
          </p>

          {/* Visual illustration */}
          <div className="rounded-xl bg-background/50 border border-border/40 p-4 sm:p-5 mb-6">
            {current.visual}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-mono text-xs"
              onClick={prev}
              disabled={step === 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </Button>

            {/* Keyboard hint */}
            <span className="hidden sm:block text-[10px] text-muted-foreground font-mono opacity-60">
              ← → arrow keys to navigate
            </span>

            <Button
              size="sm"
              className={`gap-1.5 font-mono text-xs font-bold ${
                step === total - 1
                  ? "bg-yellow-400 hover:bg-yellow-300 text-black"
                  : ""
              }`}
              onClick={next}
            >
              {step === total - 1 ? (
                <>
                  Start Betting
                  <Zap className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom step summary */}
      <div className="mt-6 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {STEPS.map((s, i) => {
          const SI = s.icon;
          return (
            <button
              key={s.n}
              onClick={() => setStep(i)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-all ${
                i === step
                  ? "bg-yellow-400/10 border border-yellow-400/30"
                  : "hover:bg-muted/40 border border-transparent"
              }`}
            >
              <SI className={`h-3.5 w-3.5 ${i <= step ? s.iconColor : "text-muted-foreground/40"}`} />
              <span className="text-[9px] font-mono text-muted-foreground leading-tight text-center hidden sm:block">
                {s.n}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Visual illustrations ────────────────────────────────────────────────────

function WelcomeVisual() {
  return (
    <div className="flex items-center justify-center gap-6 py-2">
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
          <ArrowUpCircle className="h-7 w-7 text-green-500" />
        </div>
        <span className="text-[10px] font-mono text-green-500 font-bold uppercase tracking-wider">BTC UP</span>
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="w-10 h-10 rounded-lg bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-center mb-1">
          <Zap className="h-5 w-5 text-yellow-400 fill-yellow-400" />
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">5 min</div>
        <div className="text-[10px] font-mono text-muted-foreground">Lightning</div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <ArrowDownCircle className="h-7 w-7 text-red-500" />
        </div>
        <span className="text-[10px] font-mono text-red-500 font-bold uppercase tracking-wider">BTC DOWN</span>
      </div>
    </div>
  );
}

function WindowVisual() {
  return (
    <div className="font-mono space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <Clock className="h-3.5 w-3.5 text-blue-400" />
        <span>UTC epoch-aligned windows</span>
      </div>
      <div className="grid grid-cols-6 gap-1 text-[10px]">
        {["18:00","18:05","18:10","18:15","18:20","18:25"].map((t, i) => (
          <div key={t} className={`rounded text-center py-1 px-1 ${i === 2 ? "bg-blue-400/20 border border-blue-400/40 text-blue-300 font-bold" : "bg-muted/30 text-muted-foreground"}`}>
            {t}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="text-[10px] text-muted-foreground">Time left</div>
        <div className="text-red-400 font-bold text-sm tabular-nums">02m 47s</div>
      </div>
      <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-blue-400 to-red-400 rounded-full" style={{ width: "45%" }} />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>Window open</span>
        <span className="text-red-400">Last 30s locked</span>
        <span>Close</span>
      </div>
    </div>
  );
}

function DirectionVisual() {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex-1 rounded-lg border-2 border-green-500/60 bg-green-500/10 p-3 text-center font-mono">
          <ArrowUpCircle className="h-5 w-5 text-green-500 mx-auto mb-1" />
          <div className="text-xs font-bold text-green-500 uppercase tracking-wider">BET UP</div>
          <div className="text-[10px] text-muted-foreground mt-1">124 sats in pool</div>
        </div>
        <div className="flex-1 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-center font-mono">
          <ArrowDownCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
          <div className="text-xs font-bold text-red-500 uppercase tracking-wider">BET DOWN</div>
          <div className="text-[10px] text-muted-foreground mt-1">89 sats in pool</div>
        </div>
      </div>
      <div className="space-y-1 font-mono">
        <div className="flex justify-between text-[10px]">
          <span className="text-green-500 font-bold">58.2% UP</span>
          <span className="text-muted-foreground">Pool: 213 sats</span>
          <span className="text-red-500 font-bold">41.8% DOWN</span>
        </div>
        <div className="h-2 w-full bg-red-500/20 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full" style={{ width: "58.2%" }} />
        </div>
      </div>
    </div>
  );
}

function AmountVisual() {
  return (
    <div className="font-mono space-y-3 max-w-xs mx-auto">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount (USD)</div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-3 h-10">
          <span className="text-muted-foreground">$</span>
          <span className="text-lg font-bold">1.00</span>
        </div>
      </div>
      <div className="text-right text-[10px] text-muted-foreground">
        approx. 1,432 sats at $69,832 / BTC
      </div>
      <div className="rounded-lg bg-green-600 py-2.5 text-center text-xs font-bold text-white uppercase tracking-wider">
        Generate Invoice
      </div>
      <div className="text-center text-[10px] text-muted-foreground">Minimum: $0.50 — Maximum: any amount</div>
    </div>
  );
}

function PayVisual() {
  return (
    <div className="flex items-center justify-center gap-6 py-1">
      <div className="flex flex-col items-center gap-2">
        <div className="w-20 h-20 bg-white rounded-lg p-1.5 flex items-center justify-center">
          <div className="w-full h-full grid grid-cols-5 gap-px">
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className={`rounded-sm ${[0,1,2,5,7,10,12,14,17,19,22,23,24].includes(i) ? "bg-black" : "bg-white"}`} />
            ))}
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">Scan QR</span>
      </div>
      <div className="text-muted-foreground text-xs font-mono">or</div>
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-3 py-2 flex items-center gap-2">
          <Zap className="h-4 w-4 text-yellow-400 fill-yellow-400" />
          <span className="text-xs font-mono font-bold text-yellow-400">WebLN</span>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">Copy</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">Other options</span>
      </div>
    </div>
  );
}

function ResultVisual() {
  return (
    <div className="font-mono space-y-3">
      <div className="flex items-center justify-between text-xs">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Price to beat</div>
          <div className="font-bold">$69,796.55</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Final price</div>
          <div className="font-bold text-green-400">$69,873.30</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Outcome</div>
          <div className="font-bold text-green-500 flex items-center gap-1">
            <ArrowUpCircle className="h-4 w-4" /> UP
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-[11px] text-green-400">+0.110% — UP wins</span>
      </div>
    </div>
  );
}

function WinVisual() {
  return (
    <div className="font-mono space-y-3">
      <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold">
        <Trophy className="h-4 w-4" />
        You won! — two ways to claim
      </div>
      <div className="flex gap-2">
        <div className="flex-1 rounded-lg border border-border/40 bg-muted/20 p-2.5 flex flex-col items-center gap-1.5">
          <QrCode className="h-5 w-5 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground text-center leading-tight">Scan QR in wallet<br />(LNURL-Withdraw)</span>
        </div>
        <div className="flex items-center text-muted-foreground text-[10px]">or</div>
        <div className="flex-1 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-2.5 flex flex-col items-center gap-1.5">
          <Zap className="h-5 w-5 text-yellow-400" />
          <span className="text-[10px] text-yellow-400/80 text-center leading-tight">Type Lightning<br />address</span>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground text-center">
        +2,847 sats sent directly · expires in 30 days
      </div>
    </div>
  );
}

function FeesVisual() {
  return (
    <div className="font-mono space-y-2.5 text-xs">
      <div className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-yellow-400 mt-1.5" />
        <div>
          <span className="font-bold text-yellow-400">Normal win</span>
          <span className="text-muted-foreground"> — winners share 98% of the entire pool (losers included) proportionally to their stake.</span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5" />
        <div>
          <span className="font-bold text-blue-400">Draw</span>
          <span className="text-muted-foreground"> — price unchanged at close. All bettors share 98% of the combined pool proportionally.</span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-400 mt-1.5" />
        <div>
          <span className="font-bold text-orange-400">No opposing bets</span>
          <span className="text-muted-foreground"> — your stake is refunded at 98%. Shows as REFUND in history.</span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-lg bg-muted/20 px-3 py-2.5">
        <div className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5" />
        <div>
          <span className="font-bold text-red-400">Payout expiry</span>
          <span className="text-muted-foreground"> — unclaimed winnings expire 30 days after the bet. Claim promptly.</span>
        </div>
      </div>
    </div>
  );
}
