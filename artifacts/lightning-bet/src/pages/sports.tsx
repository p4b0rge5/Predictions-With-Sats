import { useState, useEffect, useRef, useCallback } from "react";
import {
  Trophy, Clock, CheckCircle2, AlertCircle, RefreshCw,
  Copy, Zap, ShieldCheck, ChevronDown, ChevronUp, XCircle, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  outcome: "home" | "away" | "draw" | null;
  marketId: number | null;
  totalHomeSats: number;
  totalAwaySats: number;
  marketStatus: string | null;
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
      sendPayment: (paymentRequest: string) => Promise<{ preimage: string }>;
    };
  }
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MIN_SATS = 546;
const BTC_SATS = 100_000_000;

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
  return (
    <img src={src} alt={name} className={`${dim} object-contain shrink-0`} onError={() => setError(true)} />
  );
}

// ---------------------------------------------------------------------------
// Pool bar
// ---------------------------------------------------------------------------

function PoolBar({ homeSats, awaySats }: { homeSats: number; awaySats: number }) {
  const total = homeSats + awaySats;
  if (total === 0) {
    return (
      <div className="text-[10px] text-muted-foreground font-mono text-center">No bets yet — be first!</div>
    );
  }
  const homePct = (homeSats / total) * 100;
  const awayPct = 100 - homePct;
  return (
    <div className="space-y-1">
      <div className="flex h-1.5 rounded-full overflow-hidden">
        <div className="bg-green-500 transition-all" style={{ width: `${homePct}%` }} />
        <div className="bg-blue-500 transition-all" style={{ width: `${awayPct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
        <span className="text-green-400">⬆ {formatSats(homeSats)} sats</span>
        <span className="text-blue-400">{formatSats(awaySats)} sats ⬆</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sport Bet Modal
// ---------------------------------------------------------------------------

interface SportBetModalProps {
  event: SportEvent | null;
  direction: "home" | "away" | null;
  onClose: () => void;
}

function SportBetModal({ event, direction, onClose }: SportBetModalProps) {
  const { toast } = useToast();
  const [amountSats, setAmountSats] = useState("1000");
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [betInfo, setBetInfo] = useState<{ homeTeam: string; awayTeam: string; league: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [betStatus, setBetStatus] = useState<SportBetStatus | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);
  const [showPreimage, setShowPreimage] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOpen = !!event && !!direction;

  useEffect(() => {
    setWeblnAvailable(typeof window.webln !== "undefined");
  }, []);

  // Poll bet status when we have a paymentHash and status is still pending
  useEffect(() => {
    if (!paymentHash) return;
    if (betStatus && betStatus.status !== "pending") return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/sports/bets/${paymentHash}`));
        if (!res.ok) return;
        const data = (await res.json()) as SportBetStatus;
        setBetStatus(data);
        if (data.status !== "pending") clearInterval(pollRef.current!);
      } catch { /* ignore */ }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [paymentHash, betStatus?.status]);

  const handleClose = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setAmountSats("1000");
    setPaymentHash(null);
    setPaymentRequest(null);
    setBetInfo(null);
    setBetStatus(null);
    setShowPreimage(false);
    setPreimageInput("");
    setCreating(false);
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
      const data = await res.json() as { paymentHash?: string; paymentRequest?: string; error?: string; homeTeam?: string; awayTeam?: string; league?: string };
      if (!res.ok || !data.paymentHash) {
        toast({ title: "Error", description: data.error ?? "Failed to create bet", variant: "destructive" });
        return;
      }
      setPaymentHash(data.paymentHash);
      setPaymentRequest(data.paymentRequest!);
      setBetInfo({ homeTeam: data.homeTeam!, awayTeam: data.awayTeam!, league: data.league! });
    } catch {
      toast({ title: "Error", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const copyInvoice = () => {
    if (paymentRequest) {
      navigator.clipboard.writeText(paymentRequest);
      toast({ title: "Copied!", duration: 2000 });
    }
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
    // Re-fetch status
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
      setShowPreimage(false);
      setPreimageInput("");
    } catch (err) {
      toast({ title: "Verification failed", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    } finally {
      setVerifyingPreimage(false);
    }
  };

  const isHome = direction === "home";
  const teamLabel = event ? (isHome ? event.homeTeam : event.awayTeam) : "";
  const satsNum = parseInt(amountSats, 10);
  const validSats = !isNaN(satsNum) && satsNum >= MIN_SATS;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-base font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap">
            <span className={isHome ? "text-green-400" : "text-blue-400"}>
              {isHome ? "↑ HOME WINS" : "↓ AWAY WINS"}
            </span>
            <span className="text-muted-foreground font-normal text-sm truncate">{teamLabel}</span>
          </DialogTitle>
          {betInfo && (
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{betInfo.league}</p>
          )}
          {event && !betInfo && (
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">{event.league}</p>
          )}
        </DialogHeader>

        {/* ── Amount form ── */}
        {!paymentRequest && (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="sport-amount" className="text-muted-foreground uppercase text-xs tracking-wider">
                Amount (sats)
              </Label>
              <Input
                id="sport-amount"
                type="number"
                min={MIN_SATS}
                step="1"
                value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)}
                className="text-xl font-bold h-12 bg-card/50"
                autoFocus
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Min: {formatSats(MIN_SATS)} sats</span>
                <span>≈ ${((satsNum / BTC_SATS) * 95000).toFixed(2)} USD</span>
              </div>
            </div>

            {/* Quick-pick buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {[546, 1000, 5000, 10000].map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setAmountSats(String(v))}
                  className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors"
                >
                  {v >= 1000 ? `${v / 1000}k` : v}
                </button>
              ))}
            </div>

            <Button
              type="submit"
              className={`w-full h-12 text-base font-bold uppercase tracking-wider text-white ${
                isHome ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
              disabled={creating || !validSats}
            >
              {creating ? "Generating invoice…" : "Generate Invoice"}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              DRAW → 98% refund · Settled at final whistle · 2% house fee
            </p>
          </form>
        )}

        {/* ── Invoice / payment screen ── */}
        {paymentRequest && (betStatus?.status === "pending" || !betStatus) && (
          <div className="pt-1 space-y-3">
            <div className="text-center">
              <p className="text-xl font-bold text-yellow-400">Pay {formatSats(satsNum)} sats</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isHome ? "↑ HOME WINS" : "↓ AWAY WINS"} · {teamLabel}
              </p>
            </div>

            <div className="flex justify-center">
              <div
                className="bg-white p-2.5 rounded-xl shadow-lg cursor-pointer relative group"
                onClick={copyInvoice}
              >
                <QRCodeSVG value={paymentRequest} size={180} level="M" includeMargin={false} />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                  <Copy className="h-8 w-8 text-white" />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={copyInvoice}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden"
            >
              <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">
                {paymentRequest.slice(0, 30)}…
              </span>
              <span className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-bold uppercase tracking-wider">
                <Copy className="h-3.5 w-3.5" /> Copy
              </span>
            </button>

            <div className="flex items-center justify-center gap-2 text-yellow-500 text-sm animate-pulse uppercase tracking-wider font-bold">
              <Clock className="h-4 w-4 shrink-0" />
              Waiting for payment…
            </div>

            {weblnAvailable && (
              <Button
                onClick={handleWeblnPay}
                disabled={weblnPaying}
                className="w-full h-10 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black text-sm"
              >
                <Zap className="h-4 w-4 mr-2" />
                {weblnPaying ? "Paying…" : "Pay with WebLN"}
              </Button>
            )}

            <div className="border border-muted rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPreimage(!showPreimage)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Already paid? Verify manually
                </span>
                {showPreimage ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showPreimage && (
                <div className="px-3 pb-3 space-y-2 bg-muted/10 border-t border-muted">
                  <p className="text-xs text-muted-foreground pt-2 leading-relaxed">
                    Paste the 64-char hex <strong className="text-foreground">preimage</strong> shown by your wallet after payment.
                  </p>
                  <Input
                    placeholder="Paste 64-char preimage…"
                    value={preimageInput}
                    onChange={(e) => setPreimageInput(e.target.value)}
                    className="font-mono text-xs bg-background"
                  />
                  <Button
                    onClick={handleManualVerify}
                    disabled={verifyingPreimage || preimageInput.trim().length !== 64}
                    className="w-full font-bold uppercase tracking-wider"
                    variant="outline"
                    size="sm"
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {verifyingPreimage ? "Verifying…" : "Confirm Payment"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Paid ── */}
        {betStatus?.status === "paid" && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <CheckCircle2 className="h-14 w-14 text-green-500" />
            <div className="text-xl font-bold uppercase tracking-wider text-green-500">Bet Placed!</div>
            <p className="text-muted-foreground text-sm text-center">
              Rooting for <strong>{teamLabel}</strong>.<br />
              Payout settles automatically at the final whistle.
            </p>
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">
              Close
            </Button>
          </div>
        )}

        {/* ── Won ── */}
        {(betStatus?.status === "won" || betStatus?.status === "refunded") && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <CheckCircle2 className="h-14 w-14 text-yellow-400" />
            <div className="text-xl font-bold uppercase tracking-wider text-yellow-400">
              {betStatus.status === "won" ? "You Won!" : "Refunded!"}
            </div>
            <p className="text-muted-foreground text-sm text-center">
              {betStatus.payoutSats ? `Payout: ${formatSats(Number(betStatus.payoutSats))} sats` : ""}
              {betStatus.withdrawLnurl && (
                <span className="block mt-1 text-[11px]">Scan QR with your wallet to claim.</span>
              )}
            </p>
            {betStatus.withdrawLnurl && (
              <div className="bg-white p-2.5 rounded-xl">
                <QRCodeSVG value={betStatus.withdrawLnurl} size={160} level="M" />
              </div>
            )}
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">
              Close
            </Button>
          </div>
        )}

        {/* ── Lost / Expired ── */}
        {(betStatus?.status === "lost" || betStatus?.status === "expired") && (
          <div className="space-y-4 py-4 flex flex-col items-center">
            <XCircle className="h-14 w-14 text-red-500" />
            <div className="text-xl font-bold uppercase tracking-wider text-red-500">
              {betStatus.status === "lost" ? "Better luck next time" : "Invoice Expired"}
            </div>
            <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upcoming match card
// ---------------------------------------------------------------------------

function UpcomingCard({ ev, onBet }: { ev: SportEvent; onBet: (direction: "home" | "away") => void }) {
  const kickoff = msTillKickoff(ev.startsAt);
  const bettingClosed = kickoff < 5 * 60 * 1000;
  const settled = ev.marketStatus === "settled";

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
          {ev.league}
        </span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="h-3 w-3" />
          {formatKickoff(ev.startsAt)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.homeTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">HOME</span>
        </div>
        <span className="text-lg font-bold font-mono text-muted-foreground">VS</span>
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.awayTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">AWAY</span>
        </div>
      </div>

      <PoolBar homeSats={ev.totalHomeSats} awaySats={ev.totalAwaySats} />

      {settled ? (
        <div className="text-center text-[11px] text-muted-foreground font-mono py-1">Market settled</div>
      ) : bettingClosed ? (
        <div className="text-center text-[11px] text-yellow-500/80 font-mono py-1 animate-pulse">
          ⏳ Betting closed — match imminent
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            onClick={() => onBet("home")}
            className="h-10 text-xs font-mono font-bold bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/60 transition-all"
          >
            ↑ HOME WINS
          </Button>
          <Button
            size="sm"
            onClick={() => onBet("away")}
            className="h-10 text-xs font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 hover:border-blue-500/60 transition-all"
          >
            ↓ AWAY WINS
          </Button>
        </div>
      )}

      <p className="text-[9px] text-muted-foreground text-center">
        DRAW → 98% refund · 2% house fee · settled automatically at full time
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finished card
// ---------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: SportEvent["outcome"] }) {
  if (!outcome) return null;
  if (outcome === "home")
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">HOME WIN</Badge>;
  if (outcome === "away")
    return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">AWAY WIN</Badge>;
  return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">DRAW</Badge>;
}

function FinishedCard({ ev }: { ev: SportEvent }) {
  const settled = ev.marketStatus === "settled";
  return (
    <div className="rounded-xl border border-border/40 bg-card/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
          {ev.league}
        </span>
        <div className="flex items-center gap-1.5">
          <OutcomeBadge outcome={ev.outcome} />
          {settled && (
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">SETTLED</Badge>
          )}
        </div>
      </div>

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

      {(ev.totalHomeSats > 0 || ev.totalAwaySats > 0) && (
        <div className="text-[10px] font-mono text-muted-foreground flex justify-between">
          <span className="text-green-400/70">HOME pool: {formatSats(ev.totalHomeSats)} sats</span>
          <span className="text-blue-400/70">{formatSats(ev.totalAwaySats)} sats :AWAY</span>
        </div>
      )}

      {ev.outcome && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          {ev.outcome === "draw"
            ? "DRAW — all bettors refunded at 98%"
            : `${ev.outcome === "home" ? ev.homeTeam : ev.awayTeam} wins — ${settled ? "payouts distributed" : "settlement pending"}`}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Sports() {
  const [data, setData] = useState<{ upcoming: SportEvent[]; finished: SportEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const [betModal, setBetModal] = useState<{ event: SportEvent; direction: "home" | "away" } | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch(apiUrl("/api/sports/events"))
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-400" />
            <h1 className="text-xl font-bold font-mono tracking-tight">Sports Predictions</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Predict match outcomes and win sats. Pool splits between winners, settled at full time.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="text-muted-foreground shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40">
        {(["upcoming", "results"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "upcoming" ? "Upcoming Matches" : "Recent Results"}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center h-40 gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Fetching matches…</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="font-mono text-sm">Failed to load events.</p>
          <Button variant="outline" size="sm" onClick={fetchData}>Retry</Button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {tab === "upcoming" && (
            <div className="space-y-3">
              {data.upcoming.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-10 font-mono">No upcoming matches found.</p>
              )}
              {data.upcoming.map((ev) => (
                <UpcomingCard
                  key={ev.id}
                  ev={ev}
                  onBet={(direction) => setBetModal({ event: ev, direction })}
                />
              ))}
            </div>
          )}
          {tab === "results" && (
            <div className="space-y-2">
              {data.finished.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-10 font-mono">No recent results found.</p>
              )}
              {data.finished.map((ev) => (
                <FinishedCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Bet modal */}
      <SportBetModal
        event={betModal?.event ?? null}
        direction={betModal?.direction ?? null}
        onClose={() => setBetModal(null)}
      />
    </div>
  );
}
