import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bolt,
  CloudSun,
  Trophy,
  TrendingUpDown,
  Wallet,
  Zap,
  CheckCircle2,
  ShieldCheck,
  TimerReset,
  LockKeyhole,
  DollarSign,
  Gamepad2,
  Thermometer,
  Bitcoin,
  Star,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Sections data                                                      */
/* ------------------------------------------------------------------ */

const SPORTS = [
  { name: "Football (Soccer)", draw: true, detail: "European elite leagues" },
  { name: "NBA", draw: false, detail: "Regular season + playoffs" },
  { name: "NFL", draw: false, detail: "Off-season guard (Apr–Jul)" },
  { name: "MLB", draw: false, detail: "Off-season guard (Dec–Feb)" },
  { name: "MMA / UFC", draw: false, detail: "UFC, Bellator, ONE, PFL" },
  { name: "Rugby", draw: true, detail: "Six Nations, Premiership, Super Rugby…" },
  { name: "Hockey", draw: false, detail: "NHL + international leagues" },
  { name: "Basketball", draw: false, detail: "International leagues (non-NBA)" },
];

const HOW_STEPS = [
  {
    n: "01",
    title: "Pick a market",
    desc: "Crypto UP/DOWN, a sport result or a weather outcome — whatever catches your eye.",
  },
  {
    n: "02",
    title: "Enter your stake",
    desc: "Minimum $0.50 USD. The pool bar shows how many sats are on each side — a minority pick means higher payout.",
  },
  {
    n: "03",
    title: "Pay with Lightning",
    desc: "Scan the QR with any Lightning wallet (Phoenix, Alby, Zeus, Wallet of Satoshi) or use WebLN.",
  },
  {
    n: "04",
    title: "Get settled",
    desc: "When the event resolves, winners split the pool (minus a 2 % house fee). Payouts arrive via LNURL-Withdraw — straight to your wallet.",
  },
  {
    n: "05",
    title: "Find your bet later",
    desc: "All bets saved in your browser under My Bets. Lost your tab? Import with your payment hash or preimage.",
  },
];

const FEATURES = [
  {
    icon: Bolt,
    title: "Lightning-fast payments",
    desc: "Every bet is a Lightning invoice. No fiat, no platform balance, no token wrapper — just sats on and off.",
  },
  {
    icon: LockKeyhole,
    title: "No account needed",
    desc: "No sign-up, no email, no password. Pay, bet, withdraw. Your proof of payment is your identity.",
  },
  {
    icon: ShieldCheck,
    title: "Transparent pools",
    desc: "See exactly how much sats are on each outcome. Odds adjust in real time as the pool shifts.",
  },
  {
    icon: Wallet,
    title: "Wallet in, wallet out",
    desc: "Your sats never sit in a custodial account. Payouts go directly back to your Lightning wallet via LNURL-Withdraw.",
  },
  {
    icon: TimerReset,
    title: "Minutes-long rounds",
    desc: "Crypto windows open every 5, 15 or 30 minutes. Place a bet, wait a few minutes, get settled.",
  },
  {
    icon: Trophy,
    title: "Winners split the pool",
    desc: "No house rake on the losing side. All losing sats go to the winners, minus a flat 2 % fee.",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function Landing() {
  return (
    <div className="mx-auto max-w-6xl space-y-16 sm:space-y-20">

      {/* ═══ HERO ═══ */}
      <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-background/80 px-5 py-10 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:px-10 sm:py-14 lg:px-16 lg:py-20">
        {/* blurs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 top-0 h-64 w-64 rounded-full bg-orange-500/15 blur-3xl" />
          <div className="absolute -right-8 top-12 h-56 w-56 rounded-full bg-cyan-500/12 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.24em] text-orange-300">
            <Zap className="h-3.5 w-3.5" />
            Bet in sats — settle in seconds
          </div>

          <h1 className="font-mono text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Bet on crypto, sports & weather — paid with Bitcoin Lightning
          </h1>

          <p className="text-base leading-7 text-muted-foreground sm:text-lg">
            Predictions With Sats is a prediction market where you bet with real Bitcoin (sats) over the Lightning Network.
            No accounts, no sign-ups. Pick an outcome, pay with any Lightning wallet, and collect winnings straight back to your wallet.
          </p>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-none bg-yellow-400 px-8 font-mono text-xs uppercase tracking-[0.2em] text-black hover:bg-yellow-300"
            >
              <Link to="/app">
                Open Crypto Markets
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-none border-border/60 bg-background/70 px-8 font-mono text-xs uppercase tracking-[0.2em]"
            >
              <Link to="/app/sports">Browse Sports</Link>
            </Button>
          </div>

          {/* quick stats */}
          <div className="grid gap-3 pt-4 sm:grid-cols-3">
            <StatCard label="Payment" value="Bitcoin Lightning" />
            <StatCard label="Account?" value="None required" />
            <StatCard label="House fee" value="2 % flat" />
          </div>
        </div>
      </section>

      {/* ═══ THREE MARKET CATEGORIES ═══ */}
      <section className="space-y-6">
        <SectionHeader kicker="What can you bet on?" title="Three market classes, one interface" />

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Crypto */}
          <MarketCard
            icon={TrendingUpDown}
            tint="surface-tint-orange"
            kicker="Crypto"
            title="UP or DOWN in minutes"
            lines={[
              "BTC, ETH, SOL, XRP, BNB",
              "5 min, 15 min, 30 min windows",
              "New window opens on every clock mark",
              "Winners split the pool when price closes",
            ]}
            ctaLabel="Open Crypto"
            ctaHref="/app"
          />

          {/* Sports */}
          <MarketCard
            icon={Gamepad2}
            tint="surface-tint-yellow"
            kicker="Sports"
            title="8 sports, real matches"
            lines={[
              "Football, NBA, NFL, MLB, MMA, Rugby, Hockey, Basketball",
              "Home win, away win, or draw",
              "Live status tracking with auto-settlement",
              "Expanded coverage with external market data",
            ]}
            ctaLabel="View Sports"
            ctaHref="/sports"
          />

          {/* Weather */}
          <MarketCard
            icon={Thermometer}
            tint="surface-tint-cyan"
            kicker="Weather"
            title="Temperature & precipitation"
            lines={[
              "Bet on real-world forecast outcomes",
              "Daily temperature thresholds",
              "Automated settlement at midnight local time",
              "Synced from live weather data sources",
            ]}
            ctaLabel="See Weather"
            ctaHref="/weather"
          />
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section className="space-y-6">
        <SectionHeader kicker="Getting started" title="From zero to settled in five steps" />

        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-5">
          {HOW_STEPS.map((s, i) => (
            <div key={s.n} className="relative rounded-2xl border border-border/50 bg-background/70 p-5">
              <span className="font-mono text-3xl font-bold text-yellow-400/30">{s.n}</span>
              <h3 className="mt-2 font-mono text-sm font-bold uppercase tracking-wide">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ SPORTS DEEP-DIVE ═══ */}
      <section className="rounded-[2rem] border border-border/50 bg-background/70 p-6 sm:p-8 lg:p-10 space-y-6">
        <SectionHeader kicker="Sports betting" title="8 sports with draw or no-draw markets" />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SPORTS.map((s) => (
            <div
              key={s.name}
              className="rounded-xl border border-border/50 bg-background/70 p-4 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold">{s.name}</span>
                {s.draw ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-400/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-green-300">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Draw
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-red-300">
                    <Minus className="h-2.5 w-2.5" /> No draw
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{s.detail}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-center pt-2">
          <Button
            asChild
            size="lg"
            className="h-12 rounded-none bg-yellow-400 px-8 font-mono text-xs uppercase tracking-[0.2em] text-black hover:bg-yellow-300"
          >
            <Link to="/app/sports">
              Browse All Sports Markets
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ═══ FEATURES ═══ */}
      <section className="space-y-6">
        <SectionHeader kicker="Why Predictions With Sats?" title="Built for people who prefer Bitcoin" />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border/50 bg-background/70 p-5 space-y-3"
            >
              <f.icon className="h-5 w-5 text-yellow-400" />
              <h3 className="font-mono text-sm font-bold uppercase tracking-wide">{f.title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ PAYMENT FLOW ═══ */}
      <section className="rounded-[2rem] border border-border/50 bg-gradient-to-br from-yellow-400/8 via-background/90 to-cyan-400/8 p-6 sm:p-8 lg:p-10 space-y-6">
        <SectionHeader kicker="Payments" title="Every interaction uses real Bitcoin" />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Deposit */}
          <div className="rounded-2xl border border-border/50 bg-background/70 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-yellow-400" />
              <h3 className="font-mono text-sm font-bold uppercase">Placing a bet</h3>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Choose an outcome and enter your stake</li>
              <li>A Lightning invoice (Bolt11) is generated instantly</li>
              <li>Scan the QR code with any Lightning wallet or use WebLN</li>
              <li>Your bet is confirmed and locked — no deposit required</li>
            </ol>
          </div>

          {/* Withdrawal */}
          <div className="rounded-2xl border border-border/50 bg-background/70 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-400" />
              <h3 className="font-mono text-sm font-bold uppercase">Collecting winnings</h3>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>When you win, a withdraw link appears on your bet card</li>
              <li>Open the link to get an LNURL-Withdraw request</li>
              <li>Your Lightning wallet prompts you to confirm the payout address</li>
              <li>Sats arrive in your wallet — no platform balance, no waiting</li>
            </ol>
          </div>
        </div>

        <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4 text-center">
          <Bitcoin className="mx-auto h-6 w-6 text-yellow-400" />
          <p className="mt-2 font-mono text-sm font-bold text-yellow-300">
            Compatible with Phoenix, Alby, Zeus, Wallet of Satoshi and any Lightning wallet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            No registration, no platform wallet, no custodial account
          </p>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="rounded-[2rem] border border-border/60 bg-background/80 p-6 sm:p-8 lg:p-12 text-center space-y-6">
        <Star className="mx-auto h-8 w-8 text-yellow-400" />
        <h2 className="font-mono text-2xl font-bold uppercase tracking-tight sm:text-3xl">
          Ready to bet in sats?
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Crypto windows are open right now. Sports markets update live. Weather bets settle daily.
          No account needed — just your Lightning wallet.
        </p>
        <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
          <Button
            asChild
            size="lg"
            className="h-12 rounded-none bg-yellow-400 px-8 font-mono text-xs uppercase tracking-[0.2em] text-black hover:bg-yellow-300"
          >
            <Link to="/app">
              Open Crypto Markets
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 rounded-none border-border/60 bg-background/70 px-8 font-mono text-xs uppercase tracking-[0.2em]"
          >
            <Link to="/app/sports">Sports Markets</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 rounded-none border-border/60 bg-background/70 px-8 font-mono text-xs uppercase tracking-[0.2em]"
          >
            <Link to="/app/weather">Weather Markets</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{kicker}</p>
      <h2 className="mt-2 font-mono text-2xl font-bold uppercase tracking-tight sm:text-3xl">{title}</h2>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function MarketCard({
  icon: Icon,
  tint,
  kicker,
  title,
  lines,
  ctaLabel,
  ctaHref,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  kicker: string;
  title: string;
  lines: string[];
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className={`rounded-[1.5rem] border p-5 ${tint} flex flex-col`}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-foreground" />
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{kicker}</p>
      </div>
      <h3 className="mt-2 font-mono text-lg font-bold uppercase tracking-wide">{title}</h3>
      <ul className="mt-3 space-y-1.5">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-400" />
            {l}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        <Button
          asChild
          size="sm"
          variant="outline"
          className="rounded-none border-border/50 font-mono text-[11px] uppercase tracking-wider"
        >
          <Link to={ctaHref}>
            {ctaLabel}
            <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
