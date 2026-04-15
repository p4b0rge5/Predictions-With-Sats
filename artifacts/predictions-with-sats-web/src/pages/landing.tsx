import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeDollarSign,
  Bitcoin,
  CloudSun,
  Globe,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Trophy,
  Wallet,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURE_CARDS = [
  {
    icon: Bitcoin,
    title: "Bitcoin-native rails",
    body: "Bet, settle and withdraw in sats over Lightning. No platform balance, no fiat custody, no token wrapper.",
    tint: "surface-tint-orange",
  },
  {
    icon: LockKeyhole,
    title: "No account required",
    body: "The app works with invoices, payment hashes and browser-local bet recovery instead of traditional sign-up flows.",
    tint: "surface-tint-indigo",
  },
  {
    icon: Globe,
    title: "Open wallet interoperability",
    body: "Compatible with standard Lightning wallets, WebLN flows and LNURL-Withdraw for payout collection.",
    tint: "surface-tint-emerald",
  },
  {
    icon: Radar,
    title: "Live market surface",
    body: "Crypto, sports and weather markets run in one interface with visible pools, odds pressure and immediate status tracking.",
    tint: "surface-tint-cyan",
  },
];

const MARKET_PANELS = [
  {
    kicker: "Crypto",
    title: "Fast 5-minute BTC, ETH and SOL windows",
    body: "Short-cycle prediction markets with visible pool imbalance and quick feedback loops for operators who want a tighter cadence.",
    tint: "surface-tint-orange",
  },
  {
    kicker: "Sports",
    title: "Match outcomes settled in sats",
    body: "Home, away and draw markets with per-outcome liquidity, local bet tracking and Lightning-native settlement paths.",
    tint: "surface-tint-yellow",
  },
  {
    kicker: "Weather",
    title: "Real-world event markets beyond price action",
    body: "Temperature-range markets expand the app beyond pure trading narratives and show the same sat-based mechanism on different data.",
    tint: "surface-tint-cyan",
  },
];

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "Leans on decentralized money",
    body: "The strongest decentralization property here is the money rail itself: Bitcoin and Lightning are open networks, wallet-agnostic and globally accessible.",
  },
  {
    icon: Wallet,
    title: "Less platform dependence",
    body: "Users do not need to preload or leave a custodial site balance parked inside the app just to participate and withdraw.",
  },
  {
    icon: Sparkles,
    title: "Portable proofs",
    body: "Payment hash and preimage flows make bet recovery portable across sessions and devices when the user keeps their proof of payment.",
  },
  {
    icon: TimerReset,
    title: "Operationally simple",
    body: "Small invoice-driven interactions reduce onboarding friction and let someone go from landing page to first market in seconds.",
  },
];

const STEPS = [
  "Choose a market and select an outcome.",
  "Pay the Lightning invoice with any compatible wallet.",
  "Track the bet in-browser or recover it later by hash or preimage.",
  "If you win, pull payout back to your wallet over Lightning.",
];

export function Landing() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 sm:space-y-12">
      <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-background/80 px-5 py-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:px-8 sm:py-10 lg:px-12 lg:py-14">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-12 top-0 h-56 w-56 rounded-full bg-orange-500/15 blur-3xl" />
          <div className="absolute right-0 top-10 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.24em] text-orange-300">
              <Zap className="h-3.5 w-3.5" />
              Prediction markets settled in sats
            </div>

            <div className="space-y-4">
              <h1 className="max-w-4xl font-mono text-4xl font-bold uppercase leading-none tracking-tight sm:text-5xl lg:text-6xl">
                Use Lightning to operate prediction markets without platform money.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Predictions With SATS combines crypto, sports and weather markets with Bitcoin Lightning invoices,
                wallet-driven payouts and browser-local bet recovery. It is a cleaner operating model for people who
                want market exposure on open money rails instead of closed in-app balances.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-none bg-yellow-400 px-6 font-mono text-xs uppercase tracking-[0.2em] text-black hover:bg-yellow-300">
                <Link to="/app">
                  Open The App
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-none border-border/60 bg-background/70 px-6 font-mono text-xs uppercase tracking-[0.2em]">
                <Link to="/my-bets">Recover My Bets</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Payment rail</p>
                <p className="mt-2 text-lg font-semibold">Bitcoin Lightning</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Core posture</p>
                <p className="mt-2 text-lg font-semibold">No account, no custody balance</p>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Markets</p>
                <p className="mt-2 text-lg font-semibold">Crypto, sports, weather</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-[1.5rem] border border-border/60 bg-zinc-950 px-5 py-5 text-zinc-50 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Operator view</p>
                  <p className="mt-1 font-mono text-lg font-bold uppercase tracking-[0.08em]">Lightning-first flow</p>
                </div>
                <div className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-yellow-300">
                  Live
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Lightning invoice</span>
                    <span className="font-mono text-[11px] text-emerald-300">Wallet agnostic</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-yellow-400 via-orange-400 to-emerald-400" />
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">
                    Pay from Phoenix, Alby, Zeus, Wallet of Satoshi or any compatible Lightning wallet.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Recovery</p>
                    <p className="mt-2 text-lg font-semibold">Hash / preimage based</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      Keep proof of payment and you can re-import bets without a traditional user account.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">Payout path</p>
                    <p className="mt-2 text-lg font-semibold">LNURL withdraw</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      Winning bets resolve back to the wallet layer instead of a trapped site balance.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-white/5 to-white/[0.02] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">What makes it different</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    The app logic is a web product, but the money layer is open and composable. That makes the user’s
                    relationship to funds and payout rails materially less platform-dependent than a closed wallet stack.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FEATURE_CARDS.map((feature) => (
          <div key={feature.title} className={`rounded-[1.5rem] border p-5 ${feature.tint}`}>
            <feature.icon className="h-5 w-5 text-foreground" />
            <h2 className="mt-4 font-mono text-sm font-bold uppercase tracking-[0.14em]">{feature.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="rounded-[1.75rem] border border-border/50 bg-background/70 p-6 sm:p-8">
          <div className="max-w-xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Why this architecture matters</p>
            <h2 className="mt-3 font-mono text-2xl font-bold uppercase tracking-tight sm:text-3xl">
              It pushes the prediction experience closer to open internet money.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              The app is not pretending to be pure protocol software. What it does offer is a meaningful shift in how
              the user interacts with money: wallet in, wallet out, sats-native accounting, no mandatory account layer
              and portable payment proofs. That is a real product advantage.
            </p>
          </div>

          <div className="mt-8 grid gap-4">
            {PRINCIPLES.map((item) => (
              <div key={item.title} className="rounded-2xl border border-border/50 bg-background/70 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-border/50 bg-muted/40 p-2">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <h3 className="font-mono text-sm font-bold uppercase tracking-[0.14em]">{item.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-border/50 bg-background/70 p-6 sm:p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Operating loop</p>
          <h2 className="mt-3 font-mono text-2xl font-bold uppercase tracking-tight sm:text-3xl">
            From market selection to payout in four moves.
          </h2>
          <div className="mt-6 space-y-4">
            {STEPS.map((step, index) => (
              <div key={step} className="flex gap-4 rounded-2xl border border-border/50 bg-background/70 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-yellow-400/30 bg-yellow-400/10 font-mono text-sm font-bold text-yellow-300">
                  0{index + 1}
                </div>
                <p className="pt-1 text-sm leading-6 text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300">Wallet-first payout model</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The important user-facing idea is simple: the platform does not ask you to adopt its own money. It uses sats.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Market surface</p>
          <h2 className="mt-3 font-mono text-2xl font-bold uppercase tracking-tight sm:text-3xl">
            One app, multiple market classes, same sat-denominated UX.
          </h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {MARKET_PANELS.map((panel) => (
            <div key={panel.title} className={`rounded-[1.5rem] border p-5 ${panel.tint}`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{panel.kicker}</p>
              <h3 className="mt-3 font-mono text-lg font-bold uppercase tracking-[0.08em]">{panel.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{panel.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-border/60 bg-gradient-to-br from-yellow-400/12 via-background/90 to-cyan-400/10 p-6 sm:p-8 lg:p-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Start operating</p>
            <h2 className="mt-3 font-mono text-3xl font-bold uppercase tracking-tight sm:text-4xl">
              Open the app and start placing markets in sats.
            </h2>
            <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
              Go straight into crypto windows, sports outcomes, weather markets and global bet recovery. The operational
              path is already live in the same interface.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Button asChild size="lg" className="h-12 rounded-none bg-yellow-400 px-6 font-mono text-xs uppercase tracking-[0.2em] text-black hover:bg-yellow-300">
              <Link to="/app">Launch App</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 rounded-none border-border/60 bg-background/70 px-6 font-mono text-xs uppercase tracking-[0.2em]">
              <Link to="/sports">View Sports Markets</Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="h-4 w-4 text-yellow-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sats-native</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">The unit of account is sats, not points or internal credits.</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Outcome diversity</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Short-term price action sits beside sports and weather resolution events.</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
            <div className="flex items-center gap-2">
              <CloudSun className="h-4 w-4 text-cyan-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Single interface</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">One browser app for discovery, operation, recovery and payout collection.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
