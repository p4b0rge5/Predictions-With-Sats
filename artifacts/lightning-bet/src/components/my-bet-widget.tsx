import { useState, useEffect, useRef } from "react";
import { useGetBetStatus, getGetBetStatusQueryKey } from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, Clock, Trophy, Copy, X, Gift,
  ArrowUp, ArrowDown, Zap, Share2, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "lightning_bet_hashes_v2";
const MAX_STORED = 30;

// ── Storage helpers ────────────────────────────────────────────────────────────

export function saveBetHash(paymentHash: string) {
  const existing = getBetHashes();
  if (existing.includes(paymentHash)) return;
  const updated = [paymentHash, ...existing].slice(0, MAX_STORED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/** @deprecated use saveBetHash */
export function saveLastBetHash(paymentHash: string) {
  saveBetHash(paymentHash);
}

export function getBetHashes(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** @deprecated use getBetHashes */
export function getLastBetHash(): string | null {
  const hashes = getBetHashes();
  return hashes[0] ?? null;
}

export function removeBetHash(paymentHash: string) {
  const updated = getBetHashes().filter((h) => h !== paymentHash);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function clearLastBetHash() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Sound helpers ──────────────────────────────────────────────────────────────

function playTone(won: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (won) {
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch {
    // AudioContext not available — silent fail
  }
}

// ── Single bet card ────────────────────────────────────────────────────────────

interface MyBetWidgetProps {
  paymentHash: string;
  onDismiss: () => void;
}

export function MyBetWidget({ paymentHash, onDismiss }: MyBetWidgetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Lightning address payout state
  const [showLnInput, setShowLnInput] = useState(false);
  const [lnAddress, setLnAddress] = useState("");
  const [lnPaying, setLnPaying] = useState(false);
  const [lnError, setLnError] = useState<string | null>(null);

  // Track previous status for sound notification
  const prevStatusRef = useRef<string | undefined>(undefined);

  const { data: bet } = useGetBetStatus(paymentHash, {
    query: {
      enabled: true,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "pending") return 3000;
        if (status === "paid") return 15000;
        if (status === "won" && query.state.data?.withdrawStatus === "unclaimed") return 15000;
        return false;
      },
      queryKey: getGetBetStatusQueryKey(paymentHash),
    },
  });

  // Play sound when bet result arrives
  useEffect(() => {
    if (!bet) return;
    const prev = prevStatusRef.current;
    if (prev === "paid" && (bet.status === "won" || bet.status === "lost")) {
      playTone(bet.status === "won");
    }
    prevStatusRef.current = bet.status;
  }, [bet?.status]);

  const handleCopyLnurl = (lnurl: string) => {
    navigator.clipboard.writeText(lnurl);
    toast({ title: "LNURL copied!", description: "Paste it in your Lightning wallet.", duration: 3000 });
  };

  const handleClaimSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetBetStatusQueryKey(paymentHash) });
    toast({ title: "Withdrawal sent!", description: "Your winnings are on their way.", duration: 4000 });
  };

  const handlePayToAddress = async () => {
    if (!bet?.withdrawToken || !lnAddress.trim()) return;
    setLnPaying(true);
    setLnError(null);
    try {
      const res = await fetch(
        `${window.location.origin}/api/withdraw/${bet.withdrawToken}/pay-to-address`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: lnAddress.trim().toLowerCase() }),
        },
      );
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setLnError(data.error ?? "Payment failed. Try again.");
      } else {
        await queryClient.invalidateQueries({ queryKey: getGetBetStatusQueryKey(paymentHash) });
        toast({
          title: "Sats sent!",
          description: `${new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats sent to ${lnAddress.trim()}.`,
          duration: 5000,
        });
      }
    } catch {
      setLnError("Network error. Please try again.");
    } finally {
      setLnPaying(false);
    }
  };

  const handleShareX = () => {
    if (!bet) return;
    const sats = new Intl.NumberFormat().format(bet.payoutSats ?? 0);
    const dir = bet.direction === "up" ? "UP ↑" : "DOWN ↓";
    const text = `⚡ Just won ${sats} sats on Prediction With Sats! Called BTC ${dir} correctly in a 5-minute window. Try it at pwsats.com — no accounts, instant Lightning payouts.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = () => {
    if (!bet) return;
    const sats = new Intl.NumberFormat().format(bet.payoutSats ?? 0);
    const dir = bet.direction === "up" ? "UP ↑" : "DOWN ↓";
    const text = `⚡ Just won ${sats} sats on Prediction With Sats! Called BTC ${dir} correctly in a 5-minute prediction window. No accounts — bet and claim entirely via Lightning Network. pwsats.com #Bitcoin #Lightning`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied for Nostr!", description: "Paste it in your Nostr client.", duration: 3000 });
  };

  if (!bet) return null;

  const isUp = bet.direction === "up";
  const dirColor = isUp ? "text-green-500" : "text-red-500";
  const dirBg = isUp ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30";
  const isRefund = bet.windowOutcome === "no_liquidity";

  const statusInfo = (() => {
    if (bet.status === "pending")
      return { label: "Waiting for payment...", color: "text-yellow-500", pulse: true, icon: Clock };
    if (bet.status === "paid")
      return { label: "Bet confirmed — waiting for result...", color: "text-blue-400", pulse: false, icon: CheckCircle2 };
    if (bet.status === "lost")
      return { label: "Better luck next time!", color: "text-red-500", pulse: false, icon: XCircle };
    if (bet.status === "expired")
      return { label: "Bet expired", color: "text-muted-foreground", pulse: false, icon: XCircle };
    if (bet.status === "won" && bet.withdrawStatus === "claimed")
      return {
        label: isRefund ? "Refund claimed ✓" : "Prize claimed! 🎉",
        color: "text-green-500",
        pulse: false,
        icon: CheckCircle2,
      };
    return null;
  })();

  return (
    <div className={`rounded-xl border ${dirBg} bg-card/40 backdrop-blur p-4 font-mono relative`}>
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
        <span className={`flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border ${dirBg} ${dirColor}`}>
          {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {bet.direction.toUpperCase()}
        </span>
        <span className="text-muted-foreground text-xs">
          {new Intl.NumberFormat().format(bet.amountSats)} sats
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          Window #{bet.windowId}
        </span>
      </div>

      {/* Payout line */}
      {bet.status === "won" && bet.payoutSats && (
        <div className="text-green-400 text-sm font-bold mb-3">
          {isRefund
            ? `${new Intl.NumberFormat().format(bet.payoutSats)} sats refunded (2% fee)`
            : `+${new Intl.NumberFormat().format(bet.payoutSats)} sats won`}
        </div>
      )}

      {/* Status */}
      {statusInfo && (
        <div className={`flex items-center gap-2 text-xs ${statusInfo.color} ${statusInfo.pulse ? "animate-pulse" : ""}`}>
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
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs font-bold gap-1.5 border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
              onClick={handleShareX}
            >
              𝕏 Post on X
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs font-bold gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              onClick={handleShareNostr}
            >
              <Zap className="h-3 w-3" /> Copy for Nostr
            </Button>
          </div>
        </div>
      )}

      {/* CLAIM WINNINGS / REFUND — QR + LNURL flow (unchanged) */}
      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && bet.withdrawLnurl && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold uppercase tracking-wider animate-pulse">
            <Trophy className="h-3.5 w-3.5" />
            {isRefund ? "Refund ready — scan to claim" : "You won! Scan to claim"}
          </div>
          {isRefund && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              No bets were placed on the opposing side — your stake is being returned minus the 2% platform fee.
            </p>
          )}

          {/* Existing QR + copy + manual confirm */}
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
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs"
                onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy LNURL
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs bg-yellow-500 hover:bg-yellow-400 text-black"
                onClick={handleClaimSuccess}
              >
                <Gift className="h-3.5 w-3.5 mr-1.5" />
                I claimed it!
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
              Open your Lightning wallet → Scan QR or paste LNURL → Receive {new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats
            </p>
          </div>

          {/* Lightning address alternative */}
          <div className="border-t border-border/30 pt-3">
            <button
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => { setShowLnInput((v) => !v); setLnError(null); }}
            >
              <Zap className="h-3 w-3 text-yellow-400" />
              <span>Send to my Lightning address instead</span>
              {showLnInput ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>

            {showLnInput && (
              <div className="mt-2 space-y-2">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="yourname@wallet.com"
                  value={lnAddress}
                  onChange={(e) => { setLnAddress(e.target.value); setLnError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !lnPaying) handlePayToAddress(); }}
                  disabled={lnPaying}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                {lnError && (
                  <p className="text-[10px] text-red-400 leading-relaxed">{lnError}</p>
                )}
                <Button
                  size="sm"
                  className="w-full text-xs font-bold gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-black"
                  disabled={lnPaying || !lnAddress.includes("@")}
                  onClick={handlePayToAddress}
                >
                  {lnPaying
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                    : <><Zap className="h-3.5 w-3.5" /> Send {new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats</>
                  }
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  We resolve your address and pay instantly. No scanning needed.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && !bet.withdrawLnurl && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs animate-pulse mt-1">
          <Trophy className="h-3.5 w-3.5" />
          {isRefund
            ? `Refund of ${new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats ready — generating link...`
            : `You won ${new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats — generating withdrawal link...`}
        </div>
      )}
    </div>
  );
}

// ── Multi-bet list ─────────────────────────────────────────────────────────────

interface MyBetsListProps {
  hashes: string[];
  onDismiss: (hash: string) => void;
}

export function MyBetsList({ hashes, onDismiss }: MyBetsListProps) {
  if (hashes.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        My Bets ({hashes.length})
      </p>
      {hashes.map((hash) => (
        <MyBetWidget key={hash} paymentHash={hash} onDismiss={() => onDismiss(hash)} />
      ))}
    </div>
  );
}
