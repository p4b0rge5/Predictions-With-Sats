import { useNavigate } from "react-router-dom";
import {
  Zap, Clock, ArrowUpCircle, ArrowDownCircle,
  QrCode, TrendingUp, Trophy, ShieldCheck, Wallet,
} from "lucide-react";
import { SiBitcoin } from "react-icons/si";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GuideProps {
  onDone?: () => void;
}

// ---------------------------------------------------------------------------
// Bitcoin Guide — card format
// ---------------------------------------------------------------------------

const GUIDE_STEPS = [
  {
    icon: SiBitcoin,
    color: "text-orange-400",
    bg: "bg-orange-400/10 border-orange-400/30",
    title: "What is Bitcoin Prediction?",
    body: "Every 5 minutes a new betting window opens. Predict whether Bitcoin's price will be higher (UP) or lower (DOWN) when the window closes. Winners split the entire pool minus a 2% fee — no accounts, no sign-ups.",
  },
  {
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-400/10 border-blue-400/30",
    title: "5-Minute Windows",
    body: "Windows open on exact UTC minute marks (:00, :05, :10 ... :55) and close 5 minutes later. A live countdown shows how much time remains. Bets are locked in the last 30 seconds — the opening BTC price is set when the window starts.",
  },
  {
    icon: ArrowUpCircle,
    color: "text-green-400",
    bg: "bg-green-400/10 border-green-400/30",
    title: "Bet UP or DOWN",
    body: "Tap BET UP if you think BTC will close higher than the opening price. Tap BET DOWN if you think it will close lower. The pool bar shows how many sats are on each side — a minority position means a higher payout if correct.",
  },
  {
    icon: Wallet,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/30",
    title: "Enter Amount & Pay",
    body: "Minimum is 546 sats (~$0.50). After choosing a direction, enter the amount and tap Generate Invoice. Scan the QR code with any Lightning wallet (Phoenix, Alby, Wallet of Satoshi…) or click Pay with WebLN if your browser supports it. Payment confirms automatically.",
  },
  {
    icon: TrendingUp,
    color: "text-cyan-400",
    bg: "bg-cyan-400/10 border-cyan-400/30",
    title: "Settlement",
    body: "When the window closes, the live BTC price freezes and a 20-second buffer runs. The final price is then compared to the opening price:\n• UP wins — final > opening\n• DOWN wins — final < opening\n• DRAW — price unchanged; all bettors split the pool",
  },
  {
    icon: Trophy,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/30",
    title: "Claim Your Winnings",
    body: "If you won, a QR code appears on your bet card in the Live tab. Scan it with any Lightning wallet (LNURL-Withdraw) to receive your sats — your wallet pulls the payment automatically. Payouts expire 30 days after the bet.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 border-emerald-400/30",
    title: "Fees & Edge Cases",
    body: "2% house fee on every settlement.\n• No opposing bets — your stake is refunded at 98% (shown as REFUND).\n• Keep your preimage (payment proof) — you can verify your bet manually via the preimage field.\n• Unpaid invoices expire when the window closes.",
  },
  {
    icon: QrCode,
    color: "text-purple-400",
    bg: "bg-purple-400/10 border-purple-400/30",
    title: "Find Your Bet Later",
    body: "All bets placed in the current browser session appear in the My Bets section of the Live tab. If you change devices, use the Look up bet by hash field and paste your 64-character payment hash to retrieve any past result.",
  },
];

// ---------------------------------------------------------------------------
// Guide component
// ---------------------------------------------------------------------------

export function Guide({ onDone }: GuideProps = {}) {
  const navigate = useNavigate();

  const handleDone = () => {
    if (onDone) onDone(); else navigate("/");
  };

  return (
    <div className="space-y-3 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
          <SiBitcoin className="text-white w-4 h-4" />
        </div>
        <h2 className="text-base font-bold font-mono uppercase tracking-wider">Bitcoin Betting Guide</h2>
      </div>

      {/* Cards */}
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

      {/* CTA */}
      <button
        onClick={handleDone}
        className="w-full mt-2 flex items-center justify-center gap-2 py-3 rounded-xl bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 font-mono font-bold text-sm uppercase tracking-wider hover:bg-yellow-400/20 transition-colors"
      >
        <Zap className="h-4 w-4 fill-yellow-400/30" />
        Start Betting
      </button>
    </div>
  );
}
