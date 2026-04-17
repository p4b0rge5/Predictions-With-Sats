import { useNavigate } from "react-router-dom";
import {
  Clock, ArrowUpCircle,
  QrCode, TrendingUp, Trophy, ShieldCheck, Wallet,
} from "lucide-react";
import { SiBitcoin } from "react-icons/si";
import { GuidePager, type GuideStep } from "@/components/guide-pager";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GuideProps {
  onDone?: () => void;
}

// ---------------------------------------------------------------------------
// Bitcoin Guide steps
// ---------------------------------------------------------------------------

const GUIDE_STEPS: GuideStep[] = [
  {
    icon: SiBitcoin,
    color: "text-orange-400",
    iconBg: "bg-orange-400/15 border-orange-400/40",
    cardTint: "bg-orange-400/5",
    cardBorder: "border-orange-400/30",
    title: "What is Bitcoin Prediction?",
    body: "Every 5 minutes a new betting window opens. Predict whether Bitcoin's price will be higher (UP) or lower (DOWN) when the window closes. Winners split the entire pool minus a 2% fee — no accounts, no sign-ups.",
  },
  {
    icon: Clock,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "5-Minute Windows",
    body: "Windows open on exact UTC minute marks (:00, :05, :10 ... :55) and close 5 minutes later. A live countdown shows how much time remains. Bets are locked in the last 30 seconds — the opening BTC price is set when the window starts.",
  },
  {
    icon: ArrowUpCircle,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Bet UP or DOWN",
    body: "Tap BET UP if you think BTC will close higher than the opening price. Tap BET DOWN if you think it will close lower. The pool bar shows how many sats are on each side — a minority position means a higher payout if correct.",
  },
  {
    icon: Wallet,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Enter Amount & Pay",
    body: "Minimum is $0.50 USD. After choosing a direction, enter the amount and tap Generate Invoice. Scan the QR code with any Lightning wallet (Phoenix, Alby, Wallet of Satoshi…) or click Pay with WebLN if your browser supports it. Payment confirms automatically.",
  },
  {
    icon: TrendingUp,
    color: "text-cyan-400",
    iconBg: "bg-cyan-400/15 border-cyan-400/40",
    cardTint: "bg-cyan-400/5",
    cardBorder: "border-cyan-400/30",
    title: "Settlement",
    body: "When the window closes, the live BTC price freezes and a 20-second buffer runs. The final price is then compared to the opening price:\n• UP wins — final > opening\n• DOWN wins — final < opening\n• DRAW — price unchanged; all bettors split the pool",
  },
  {
    icon: Trophy,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Claim Your Winnings",
    body: "If you won, a QR code appears on your bet card in the Live tab. Scan it with any Lightning wallet (LNURL-Withdraw) to receive your sats — your wallet pulls the payment automatically. Payouts expire 30 days after the bet.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Fees & Edge Cases",
    body: "2% house fee on normal settlements.\n• No opposing bets — your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your preimage (payment proof) — you can verify your bet manually via the preimage field.\n• Unpaid invoices expire when the window closes.",
  },
  {
    icon: QrCode,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Find Your Bet Later",
    body: "All bets placed in the current browser session appear in My Bets. If you change devices, use the global My Bets page to import a past bet with your payment hash or preimage.",
  },
];

// ---------------------------------------------------------------------------
// Guide component
// ---------------------------------------------------------------------------

export function Guide({ onDone }: GuideProps = {}) {
  const navigate = useNavigate();
  const handleDone = () => { if (onDone) onDone(); else navigate("/app"); };

  return (
    <GuidePager
      steps={GUIDE_STEPS}
      onDone={handleDone}
      header={
        <>
          <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
            <SiBitcoin className="text-white w-4 h-4" />
          </div>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">Bitcoin Betting Guide</h2>
        </>
      }
    />
  );
}
