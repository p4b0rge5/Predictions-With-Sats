import { useState, useEffect, useRef, useCallback } from "react";
import { format } from "date-fns";
import {
  Trophy, Clock, CheckCircle2, AlertCircle, RefreshCw,
  Copy, Zap, ShieldCheck, ChevronDown, ChevronUp, XCircle,
  BookOpen, Wallet, Handshake, Coins, Award, ListChecks,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { getSportsBetHashes, removeSportsBetHash, saveSportsBetHash } from "@/components/my-bet-widget";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Direction = "home" | "draw" | "away";
type SportKey = "football";
type ContentTab = "guide" | "my-bets" | "upcoming" | "results";

interface SportDef {
  key: SportKey;
  label: string;
  icon: string;
  apiFilter?: string;
}

const SPORTS: SportDef[] = [
  { key: "football", label: "Football", icon: "⚽", apiFilter: "soccer" },
];

interface SportEvent {
  id: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeBadge: string | null;
  awayBadge: string | null;
  league: string;
  sport: string;
  startsAt: string;
  status: "upcoming" | "finished" | "live";
  homeScore: number | null;
  awayScore: number | null;
  outcome: "home" | "draw" | "away" | null;
  marketId: number | null;
  totalHomeSats: number;
  totalDrawSats: number;
  totalAwaySats: number;
  marketStatus: string | null;
  marketOutcome: string | null;
  marketSettledAt: string | null;
}

interface SportBetStatus {
  id: number;
  paymentHash: string;
  direction: string;
  amountSats: number;
  status: string;
  payoutSats: number | null;
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  market: {
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    status: string;
    outcome: string | null;
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
const REFRESH_INTERVAL_MS = 30_000;

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function formatSats(n: number) {
  return new Intl.NumberFormat().format(n);
}

function formatKickoff(isoStr: string) {
  return new Date(isoStr).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function msTillKickoff(isoStr: string) {
  return new Date(isoStr).getTime() - Date.now();
}

const DIRECTION_LABELS: Record<Direction, string> = {
  home: "HOME",
  draw: "DRAW",
  away: "AWAY",
};

const DIRECTION_COLORS: Record<Direction, { btn: string; text: string }> = {
  home: { btn: "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20 hover:border-green-500/60", text: "text-green-400" },
  draw: { btn: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20 hover:border-yellow-500/60", text: "text-yellow-400" },
  away: { btn: "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20 hover:border-blue-500/60", text: "text-blue-400" },
};

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
  return <img src={src} alt={name} className={`${dim} object-contain shrink-0`} onError={() => setError(true)} />;
}

// ---------------------------------------------------------------------------
// Three-way pool bar
// ---------------------------------------------------------------------------

function PoolBar({ homeSats, drawSats, awaySats }: { homeSats: number; drawSats: number; awaySats: number }) {
  const total = homeSats + drawSats + awaySats;
  const pH = total > 0 ? (homeSats / total) * 100 : 100 / 3;
  const pD = total > 0 ? (drawSats / total) * 100 : 100 / 3;
  const pA = total > 0 ? (awaySats / total) * 100 : 100 / 3;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center font-mono text-xs mb-1">
        <span className="font-bold text-green-500">{pH.toFixed(1)}% HOME</span>
        <span className="text-[10px] text-muted-foreground">Pool: {formatSats(total)} sats</span>
        <span className="font-bold text-blue-500">{pA.toFixed(1)}% AWAY</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        <div className="bg-green-500 transition-all" style={{ width: `${pH}%` }} />
        <div className="bg-yellow-400 transition-all" style={{ width: `${pD}%` }} />
        <div className="bg-blue-500 transition-all" style={{ width: `${pA}%` }} />
      </div>
      <div className="text-center text-[10px] font-mono font-bold text-yellow-400">
        {pD.toFixed(1)}% DRAW
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Football Guide
// ---------------------------------------------------------------------------

const GUIDE_STEPS = [
  {
    icon: BookOpen,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 border-yellow-400/30",
    title: "How Sports Predictions Work",
    body: "Choose an upcoming football match and predict the outcome: HOME win, DRAW, or AWAY win. Pay your bet via the Lightning Network (no account needed). Winners split the entire pool minus a 2% house fee.",
  },
  {
    icon: Wallet,
    color: "text-blue-400",
    bg: "bg-blue-400/10 border-blue-400/30",
    title: "Pay with Lightning",
    body: "After picking a side, scan the QR code with any Lightning wallet (Phoenix, Wallet of Satoshi, Alby, etc.) or use WebLN if your browser supports it. Minimum bet is 546 sats (~$0.50).",
  },
  {
    icon: Handshake,
    color: "text-green-400",
    bg: "bg-green-400/10 border-green-400/30",
    title: "Three Outcomes — All Real",
    body: "Unlike some platforms, DRAW is a fully supported outcome. If the match ends in a draw, only bettors who picked DRAW collect. No partial refunds — every bet counts.",
  },
  {
    icon: Coins,
    color: "text-purple-400",
    bg: "bg-purple-400/10 border-purple-400/30",
    title: "Pool & Payout",
    body: "All bets on a match flow into one shared pool. After the final whistle, winners split the total pool proportional to their stake (minus 2% fee). Payout arrives via Lightning — scan the withdrawal QR to claim your sats.",
  },
  {
    icon: Award,
    color: "text-orange-400",
    bg: "bg-orange-400/10 border-orange-400/30",
    title: "Automatic Settlement",
    body: "Our system checks match results every 5 minutes. Once a result is confirmed, payouts are calculated and withdrawal QR codes are generated automatically. No manual action needed.",
  },
  {
    icon: ListChecks,
    color: "text-red-400",
    bg: "bg-red-400/10 border-red-400/30",
    title: "Tips & Rules",
    body: "• Betting closes 5 minutes before kick-off.\n• If nobody bets on the winning side, the house keeps the pool.\n• Keep your preimage (payment proof) — you can verify your bet manually if needed.\n• Odds are implied by the pool: bet early for better value.",
  },
];

function FootballGuide({ onDone }: { onDone?: () => void } = {}) {
  return (
    <div className="space-y-3 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">⚽</span>
        <h2 className="text-base font-bold font-mono uppercase tracking-wider">Football Betting Guide</h2>
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
  onClose: () => void;
}

function SportBetModal({ event, direction, onClose }: SportBetModalProps) {
  const { toast } = useToast();
  const [amountSats, setAmountSats] = useState("1000");
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [betStatus, setBetStatus] = useState<SportBetStatus | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [showPreimage, setShowPreimage] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setWeblnAvailable(typeof window.webln !== "undefined"); }, []);

  useEffect(() => {
    if (!paymentHash) return;
    if (betStatus && betStatus.status !== "pending") return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/sports/bets/${paymentHash}`));
        if (!res.ok) return;
        const data = (await res.json()) as SportBetStatus;
        setBetStatus(data);
        if (data.status !== "pending") {
          clearInterval(pollRef.current!);
          if (data.status === "paid" || data.status === "won") saveSportsBetHash(paymentHash);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [paymentHash, betStatus?.status]);

  const handleClose = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setAmountSats("1000"); setPaymentHash(null); setPaymentRequest(null);
    setBetStatus(null); setShowPreimage(false); setPreimageInput(""); setCreating(false);
    onClose();
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sats = parseInt(amountSats, 10);
    if (!sats || sats < MIN_SATS) {
      toast({ title: "Invalid amount", description: `Minimum is ${MIN_SATS} sats`, variant: "destructive" });
      return;
    }
    if (!event || !direction) return;
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/api/sports/bets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, direction, amountSats: sats }),
      });
      const data = await res.json() as { paymentHash?: string; paymentRequest?: string; error?: string };
      if (!res.ok || !data.paymentHash) {
        toast({ title: "Error", description: data.error ?? "Failed to create bet", variant: "destructive" });
        return;
      }
      setPaymentHash(data.paymentHash);
      setPaymentRequest(data.paymentRequest!);
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
    const res = await fetch(apiUrl(`/api/sports/bets/${paymentHash}/verify-preimage`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preimage }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Verification failed");
    }
    const statusRes = await fetch(apiUrl(`/api/sports/bets/${paymentHash}`));
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
  const satsNum = parseInt(amountSats, 10);
  const validSats = !isNaN(satsNum) && satsNum >= MIN_SATS;
  const teamLabel = direction && event ? directionLabel(direction, event) : "";
  const colors = direction ? DIRECTION_COLORS[direction] : DIRECTION_COLORS.home;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
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
              <Label htmlFor="sport-amount" className="text-muted-foreground uppercase text-xs tracking-wider">Amount (sats)</Label>
              <Input id="sport-amount" type="number" min={MIN_SATS} step="1" value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)} className="text-xl font-bold h-12 bg-card/50" autoFocus />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Min: {formatSats(MIN_SATS)} sats</span>
                <span>≈ ${((!isNaN(satsNum) ? satsNum : 0) / BTC_SATS * APPROX_BTC_USD).toFixed(2)} USD</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[546, 1000, 5000, 10000].map((v) => (
                <button type="button" key={v} onClick={() => setAmountSats(String(v))}
                  className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                  {v >= 1000 ? `${v / 1000}k` : v}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={creating || !validSats}
              className={`w-full h-12 text-base font-bold uppercase tracking-wider ${colors.btn}`}>
              {creating ? "Generating invoice…" : "Generate Invoice"}
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
            <CheckCircle2 className="h-14 w-14 text-yellow-400" />
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

function UpcomingCard({ ev, onBet }: { ev: SportEvent; onBet: (dir: Direction) => void }) {
  const bettingClosed = msTillKickoff(ev.startsAt) < 5 * 60 * 1000;
  const settled = ev.marketStatus === "settled";
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">{ev.league}</span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="h-3 w-3" />{formatKickoff(ev.startsAt)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.homeTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">HOME</span>
        </div>
        <span className="text-base font-bold font-mono text-muted-foreground">VS</span>
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.awayTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">AWAY</span>
        </div>
      </div>
      {settled ? (
        <div className="text-center text-[11px] text-muted-foreground font-mono py-1">Market settled</div>
      ) : bettingClosed ? (
        <div className="text-center text-[11px] text-yellow-500/80 font-mono py-1 animate-pulse">
          ⏳ Betting closed — match imminent
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {(["home", "draw", "away"] as Direction[]).map((dir) => (
            <Button key={dir} size="sm" onClick={() => onBet(dir)}
              className={`h-10 text-[11px] font-mono font-bold transition-all border ${DIRECTION_COLORS[dir].btn}`}>
              {dir === "home" ? "↑" : dir === "away" ? "↓" : "="} {DIRECTION_LABELS[dir]}
            </Button>
          ))}
        </div>
      )}
      <PoolBar homeSats={ev.totalHomeSats} drawSats={ev.totalDrawSats ?? 0} awaySats={ev.totalAwaySats} />
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

function FinishedCard({ ev }: { ev: SportEvent }) {
  const settled = ev.marketStatus === "settled";
  const drawSats = ev.totalDrawSats ?? 0;
  const winner = ev.marketOutcome ?? ev.outcome;
  const settledAt = ev.marketSettledAt;

  return (
    <div className="rounded-xl border border-border/40 bg-card/20 p-3 space-y-2.5">
      {/* League + badges */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">{ev.league}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <OutcomeBadge outcome={ev.outcome} />
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
          <span className={ev.outcome === "home" ? "text-green-400" : ""}>{ev.homeScore}</span>
          <span className="text-muted-foreground">–</span>
          <span className={ev.outcome === "away" ? "text-blue-400" : ""}>{ev.awayScore}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="text-xs font-semibold truncate text-right">{ev.awayTeam}</span>
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
        </div>
      </div>

      {/* Outcome description */}
      {ev.outcome && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          {ev.outcome === "draw"
            ? `DRAW — Draw bettors collect the pool${settled ? "" : " (settlement pending)"}`
            : `${ev.outcome === "home" ? ev.homeTeam : ev.awayTeam} wins — ${settled ? "payouts distributed" : "settlement pending"}`}
        </div>
      )}

      {/* Settlement timestamp */}
      {settledAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono border-t border-border/30 pt-2">
          <Clock className="h-3 w-3 shrink-0" />
          Resolved {format(new Date(settledAt), "MMM d, yyyy · HH:mm")} UTC
        </div>
      )}
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
  withdrawLnurl: string | null;
  withdrawStatus: string | null;
  market: { eventName: string; homeTeam: string; awayTeam: string; league: string; status: string; outcome: string | null } | null;
}

function SportBetStatusBadge({ status }: { status: string }) {
  if (status === "pending")  return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[9px]">PENDING</Badge>;
  if (status === "paid")     return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px]">PLACED</Badge>;
  if (status === "won")      return <Badge className="bg-yellow-400/20 text-yellow-300 border-yellow-400/30 text-[9px]">WON 🏆</Badge>;
  if (status === "lost")     return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">LOST</Badge>;
  if (status === "expired")  return <Badge className="bg-muted text-muted-foreground text-[9px]">EXPIRED</Badge>;
  return <Badge className="text-[9px]">{status.toUpperCase()}</Badge>;
}

function SportBetStatusCard({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const [bet, setBet] = useState<SportBetRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(apiUrl(`/api/sports/bets/${hash}`));
        if (!res.ok) { setNotFound(true); return; }
        const data = await res.json() as SportBetRecord;
        setBet(data);
        if (data.status === "pending") {
          pollRef.current = setInterval(async () => {
            const r = await fetch(apiUrl(`/api/sports/bets/${hash}`));
            if (!r.ok) return;
            const d = await r.json() as SportBetRecord;
            setBet(d);
            if (d.status !== "pending") clearInterval(pollRef.current!);
          }, 3000);
        }
      } catch { setNotFound(true); }
    };
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hash]);

  if (notFound) return null;
  if (!bet) return <div className="h-16 rounded-xl border border-border/40 bg-card/30 animate-pulse" />;

  const dirColor = DIRECTION_COLORS[bet.direction as Direction] ?? DIRECTION_COLORS.home;
  const dirLabel = DIRECTION_LABELS[bet.direction as Direction] ?? bet.direction.toUpperCase();

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-2 font-mono">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${dirColor.text}`}>
            {bet.direction === "home" ? "↑" : bet.direction === "away" ? "↓" : "="} {dirLabel}
          </span>
          <SportBetStatusBadge status={bet.status} />
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
      {bet.market && (
        <>
          <p className="text-xs text-foreground">{bet.market.homeTeam} vs {bet.market.awayTeam}</p>
          <p className="text-[10px] text-muted-foreground">{bet.market.league}</p>
        </>
      )}
      <p className="text-[10px] text-muted-foreground">{formatSats(bet.amountSats)} sats wagered</p>
      {bet.status === "won" && bet.payoutSats && (
        <div className="border-t border-border/30 pt-3 space-y-2 flex flex-col items-center">
          <p className="text-xs text-yellow-400 font-bold">PAYOUT: {formatSats(Number(bet.payoutSats))} sats</p>
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

function SportMyBetsTab({ hashes, onDismiss }: { hashes: string[]; onDismiss: (h: string) => void }) {
  if (hashes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <Trophy className="h-10 w-10" />
        <p className="font-mono text-sm">No sports bets yet</p>
        <p className="font-mono text-xs text-center opacity-60">Bets you place on upcoming matches will appear here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {hashes.map((h) => (
        <SportBetStatusCard key={h} hash={h} onDismiss={() => onDismiss(h)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Sports() {
  const [activeSport, setActiveSport] = useState<SportKey>("football");
  const [activeTab, setActiveTab] = useState<ContentTab>("upcoming");
  const [data, setData] = useState<{ upcoming: SportEvent[]; finished: SportEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [betModal, setBetModal] = useState<{ event: SportEvent; direction: Direction } | null>(null);
  const [betHashes, setBetHashes] = useState<string[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setBetHashes(getSportsBetHashes()); }, []);

  const fetchData = useCallback((quiet = false) => {
    if (!quiet) { setLoading(true); setError(false); }
    fetch(apiUrl("/api/sports/events"))
      .then((r) => r.json())
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    refreshTimerRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [fetchData]);

  const activeSportDef = SPORTS.find((s) => s.key === activeSport)!;

  return (
    <div className="max-w-3xl mx-auto space-y-0">

      {/* ── Sport selector chips ── */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {SPORTS.map((sp) => (
          <button
            key={sp.key}
            onClick={() => setActiveSport(sp.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
              activeSport === sp.key
                ? "bg-yellow-400/20 text-yellow-300 border-yellow-400/50"
                : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
            }`}
          >
            <span className="text-sm leading-none">{sp.icon}</span>
            {sp.label}
          </button>
        ))}
      </div>

      {/* ── Content tabs: Guide | Upcoming | Results ── */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-4">
        {([
          { key: "guide",    label: "Guide" },
          { key: "my-bets",  label: "My Bets" },
          { key: "upcoming", label: "Upcoming" },
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
      {activeTab === "guide" && (
        activeSportDef.key === "football" ? <FootballGuide onDone={() => { setActiveTab("upcoming"); window.scrollTo({ top: 0, behavior: "smooth" }); }} /> : (
          <p className="text-center text-muted-foreground text-sm py-10 font-mono">Guide coming soon.</p>
        )
      )}

      {/* ── My Bets ── */}
      {activeTab === "my-bets" && (
        <SportMyBetsTab hashes={betHashes} onDismiss={(h) => { removeSportsBetHash(h); setBetHashes(getSportsBetHashes()); }} />
      )}

      {/* ── Upcoming Matches ── */}
      {activeTab === "upcoming" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeSportDef.icon} {activeSportDef.label} — Upcoming
            </p>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loading && !data && (
            <div className="flex items-center justify-center h-40 gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="font-mono text-sm">Fetching matches…</span>
            </div>
          )}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p className="font-mono text-sm">Failed to load matches.</p>
              <Button variant="outline" size="sm" onClick={() => fetchData()}>Retry</Button>
            </div>
          )}
          {!error && data && (
            data.upcoming.length === 0
              ? <p className="text-center text-muted-foreground text-sm py-10 font-mono">No upcoming matches.</p>
              : data.upcoming.map((ev) => (
                  <UpcomingCard key={ev.id} ev={ev} onBet={(dir) => setBetModal({ event: ev, direction: dir })} />
                ))
          )}
        </div>
      )}

      {/* ── Recent Results ── */}
      {activeTab === "results" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeSportDef.icon} {activeSportDef.label} — Recent Results
            </p>
            <button
              onClick={() => fetchData()}
              disabled={loading}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {loading && !data && (
            <div className="flex items-center justify-center h-40 gap-3 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin" />
              <span className="font-mono text-sm">Fetching results…</span>
            </div>
          )}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8" />
              <p className="font-mono text-sm">Failed to load results.</p>
              <Button variant="outline" size="sm" onClick={() => fetchData()}>Retry</Button>
            </div>
          )}
          {!error && data && (
            data.finished.length === 0
              ? <p className="text-center text-muted-foreground text-sm py-10 font-mono">No recent results.</p>
              : data.finished.map((ev) => <FinishedCard key={ev.id} ev={ev} />)
          )}
        </div>
      )}

      <SportBetModal
        event={betModal?.event ?? null}
        direction={betModal?.direction ?? null}
        onClose={() => { setBetModal(null); setBetHashes(getSportsBetHashes()); }}
      />
    </div>
  );
}
