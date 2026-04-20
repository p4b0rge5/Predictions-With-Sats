import { useState, useEffect, useRef } from "react";
import { useGetBetStatus, getGetBetStatusQueryKey, getGetBetStatusQueryOptions } from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2, XCircle, Clock, Trophy, Copy, X, Gift,
  ArrowUp, ArrowDown, Zap, Share2, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQueries } from "@tanstack/react-query";

const STORAGE_KEY = "predictions_with_sats_hashes_v1";
const LEGACY_STORAGE_KEY = "lightning_bet_hashes_v2";
const SPORTS_STORAGE_KEY = "predictions_with_sats_sports_hashes_v1";
const LEGACY_SPORTS_STORAGE_KEY = "lightning_bet_sports_hashes_v1";
const SPORTS_POLY_STORAGE_KEY = "predictions_with_sats_sports_poly_hashes_v1";
const LEGACY_SPORTS_POLY_STORAGE_KEY = "lightning_bet_sports_poly_hashes_v1";
const WEATHER_STORAGE_KEY = "predictions_with_sats_weather_hashes_v1";
const LEGACY_WEATHER_STORAGE_KEY = "lightning_bet_weather_hashes_v1";
const MAX_STORED = 30;

// Per-asset storage keys — ensure BTC, ETH and SOL bets are stored separately
const ASSET_STORAGE_KEYS = {
  btc: "predictions_with_sats_btc_hashes_v1",
  eth: "predictions_with_sats_eth_hashes_v1",
  sol: "predictions_with_sats_sol_hashes_v1",
  xrp: "predictions_with_sats_xrp_hashes_v1",
  bnb: "predictions_with_sats_bnb_hashes_v1",
} as const;

// ── Generic storage helper ──────────────────────────────────────────────────

const LEGACY_ASSET_STORAGE_KEYS = {
  btc: "lightning_bet_btc_hashes_v1",
  eth: "lightning_bet_eth_hashes_v1",
  sol: "lightning_bet_sol_hashes_v1",
  xrp: "lightning_bet_xrp_hashes_v1",
  bnb: "lightning_bet_bnb_hashes_v1",
} as const;

function readStoredHashes(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeHashes(...collections: string[][]): string[] {
  return [...new Set(collections.flat())].slice(0, MAX_STORED);
}

function migrateHashes(key: string, legacyKeys: string[] = []): void {
  const merged = mergeHashes(
    readStoredHashes(key),
    ...legacyKeys.map((legacyKey) => readStoredHashes(legacyKey)),
  );

  if (merged.length > 0) {
    localStorage.setItem(key, JSON.stringify(merged));
  }
}

function readHashes(key: string, legacyKeys: string[] = []): string[] {
  migrateHashes(key, legacyKeys);
  return readStoredHashes(key);
}

function writeHash(key: string, paymentHash: string, legacyKeys: string[] = []) {
  migrateHashes(key, legacyKeys);
  const existing = readStoredHashes(key);
  if (existing.includes(paymentHash)) return;
  localStorage.setItem(key, JSON.stringify([paymentHash, ...existing].slice(0, MAX_STORED)));
}

function deleteHash(key: string, paymentHash: string, legacyKeys: string[] = []) {
  for (const storageKey of [key, ...legacyKeys]) {
    const remaining = readStoredHashes(storageKey).filter((h) => h !== paymentHash);
    if (remaining.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(storageKey);
    }
  }
}

// ── Crypto (Bitcoin/ETH/SOL) — legacy combined key ───────────────────────────

export function saveBetHash(paymentHash: string)    { writeHash(STORAGE_KEY, paymentHash, [LEGACY_STORAGE_KEY]); }
export function getBetHashes(): string[]            { return readHashes(STORAGE_KEY, [LEGACY_STORAGE_KEY]); }
export function removeBetHash(paymentHash: string)  { deleteHash(STORAGE_KEY, paymentHash, [LEGACY_STORAGE_KEY]); }

/** @deprecated */ export function saveLastBetHash(paymentHash: string) { saveBetHash(paymentHash); }
/** @deprecated */ export function getLastBetHash(): string | null { return getBetHashes()[0] ?? null; }
export function clearLastBetHash() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

// ── Per-asset storage (BTC / ETH / SOL isolated) ─────────────────────────────

export type CryptoAsset = keyof typeof ASSET_STORAGE_KEYS;

export function saveBetHashForAsset(asset: CryptoAsset, paymentHash: string) {
  writeHash(ASSET_STORAGE_KEYS[asset], paymentHash, [LEGACY_ASSET_STORAGE_KEYS[asset]]);
}

export function getBetHashesForAsset(asset: CryptoAsset): string[] {
  return readHashes(ASSET_STORAGE_KEYS[asset], [LEGACY_ASSET_STORAGE_KEYS[asset]]);
}

export function removeBetHashForAsset(asset: CryptoAsset, paymentHash: string) {
  deleteHash(ASSET_STORAGE_KEYS[asset], paymentHash, [LEGACY_ASSET_STORAGE_KEYS[asset]]);
}

// ── Sports — per-subcategory storage ─────────────────────────────────────────
//
// Each sport subcategory (football, nba, etc.) gets its own isolated storage key
// so "My Bets" only shows bets for the currently active sport.
// Pattern: `predictions_with_sats_sport_<sportKey>_hashes_v1`
//
// Adding a new sport requires zero changes here — just pass the new sportKey.

function sportStorageKey(sportKey: string): string {
  return `predictions_with_sats_sport_${sportKey}_hashes_v1`;
}

function legacySportStorageKey(sportKey: string): string {
  return `lightning_bet_sport_${sportKey}_hashes_v1`;
}

export function saveSportBetHashForKey(sportKey: string, paymentHash: string) {
  writeHash(sportStorageKey(sportKey), paymentHash, [legacySportStorageKey(sportKey)]);
}

export function getSportBetHashesForKey(sportKey: string): string[] {
  return readHashes(sportStorageKey(sportKey), [legacySportStorageKey(sportKey)]);
}

export function removeSportBetHashForKey(sportKey: string, paymentHash: string) {
  deleteHash(sportStorageKey(sportKey), paymentHash, [legacySportStorageKey(sportKey)]);
}

// Legacy monolithic key — kept for backward compatibility; no longer written to.
export function saveSportsBetHash(paymentHash: string)   { writeHash(SPORTS_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_STORAGE_KEY]); }
export function getSportsBetHashes(): string[]           { return readHashes(SPORTS_STORAGE_KEY, [LEGACY_SPORTS_STORAGE_KEY]); }
export function removeSportsBetHash(paymentHash: string) { deleteHash(SPORTS_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_STORAGE_KEY]); }

// ── Sports+ ──────────────────────────────────────────────────────────────────

export function saveSportsPolyBetHash(paymentHash: string) {
  writeHash(SPORTS_POLY_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_POLY_STORAGE_KEY]);
}

export function getSportsPolyBetHashes(): string[] {
  return readHashes(SPORTS_POLY_STORAGE_KEY, [LEGACY_SPORTS_POLY_STORAGE_KEY]);
}

export function removeSportsPolyBetHash(paymentHash: string) {
  deleteHash(SPORTS_POLY_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_POLY_STORAGE_KEY]);
}

// ── One-time migration: move old monolithic sports hashes → football bucket ──
// Runs idempotently (migration flag stored in localStorage). Any bet saved before
// the per-sport split is assumed to be a football bet (NBA was added later).

const SPORTS_MIGRATION_FLAG = "predictions_with_sats_sports_migration_v1";

export function migrateLegacySportsBetHashes() {
  if (localStorage.getItem(SPORTS_MIGRATION_FLAG)) return; // already done
  const legacy = mergeHashes(
    readStoredHashes(LEGACY_SPORTS_STORAGE_KEY),
    readStoredHashes(legacySportStorageKey("football")),
  );
  if (legacy.length > 0) {
    const footballKey = sportStorageKey("football");
    const existing = readHashes(footballKey, [legacySportStorageKey("football")]);
    const merged = mergeHashes(existing, legacy);
    localStorage.setItem(footballKey, JSON.stringify(merged));
  }
  localStorage.setItem(SPORTS_MIGRATION_FLAG, "1");
}

// ── Weather ───────────────────────────────────────────────────────────────────

export function saveWeatherBetHash(paymentHash: string)   { writeHash(WEATHER_STORAGE_KEY, paymentHash, [LEGACY_WEATHER_STORAGE_KEY]); }
export function getWeatherBetHashes(): string[]           { return readHashes(WEATHER_STORAGE_KEY, [LEGACY_WEATHER_STORAGE_KEY]); }
export function removeWeatherBetHash(paymentHash: string) { deleteHash(WEATHER_STORAGE_KEY, paymentHash, [LEGACY_WEATHER_STORAGE_KEY]); }

export function removeStoredBetHashEverywhere(paymentHash: string) {
  deleteHash(STORAGE_KEY, paymentHash, [LEGACY_STORAGE_KEY]);

  for (const asset of Object.keys(ASSET_STORAGE_KEYS) as CryptoAsset[]) {
    deleteHash(ASSET_STORAGE_KEYS[asset], paymentHash, [LEGACY_ASSET_STORAGE_KEYS[asset]]);
  }

  deleteHash(SPORTS_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_STORAGE_KEY]);
  for (const sportKey of ["football", "nba", "nfl", "mlb", "mma", "rugby"]) {
    deleteHash(sportStorageKey(sportKey), paymentHash, [legacySportStorageKey(sportKey)]);
  }

  deleteHash(SPORTS_POLY_STORAGE_KEY, paymentHash, [LEGACY_SPORTS_POLY_STORAGE_KEY]);
  deleteHash(WEATHER_STORAGE_KEY, paymentHash, [LEGACY_WEATHER_STORAGE_KEY]);
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
          description: `${new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats sent to ${lnAddress.trim()}.`,
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
    const sats = new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0);
    const dir = bet.direction === "up" ? "UP ↑" : "DOWN ↓";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Called BTC ${dir} correctly in a 5-minute window. Try it at pwsats.com — no accounts, instant Lightning payouts.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleShareNostr = () => {
    if (!bet) return;
    const sats = new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0);
    const dir = bet.direction === "up" ? "UP ↑" : "DOWN ↓";
    const text = `⚡ Just won ${sats} sats on Predictions With Sats! Called BTC ${dir} correctly in a 5-minute prediction window. No accounts — bet and claim entirely via Lightning Network. pwsats.com #Bitcoin #Lightning`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied for Nostr!", description: "Paste it in your Nostr client.", duration: 3000 });
  };

  if (!bet) return null;

  const isUp = bet.direction === "up";
  const dirColor = isUp ? "text-green-500" : "text-red-500";
  const dirCardClass = isUp ? "surface-tint-green" : "surface-tint-red";
  const dirPillClass = isUp ? "bg-green-500/20 border-green-500/50" : "bg-red-500/20 border-red-500/50";
  const isDraw = bet.windowOutcome === "draw";
  const isRefund = bet.windowOutcome === "no_liquidity" || isDraw;

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
    <div className={`rounded-xl border ${dirCardClass} card-safe p-4 font-mono relative`}>
      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Header row */}
      <div className="card-row-wrap mb-3 pr-6">
        <span className={`flex items-center gap-1 font-bold text-sm px-2 py-0.5 rounded border ${dirPillClass} ${dirColor}`}>
          {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {bet.direction.toUpperCase()}
        </span>
        <span className="text-muted-foreground text-xs card-text-safe">
          {new Intl.NumberFormat("en-US").format(bet.amountSats)} sats
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto card-text-safe">
          Window #{bet.windowId}
        </span>
      </div>

      {/* Payout line */}
      {bet.status === "won" && bet.payoutSats && (
        <div className="text-green-400 text-sm font-bold mb-3">
          {isRefund
            ? `${new Intl.NumberFormat("en-US").format(bet.payoutSats)} sats refunded (0.5% fee)`
            : `+${new Intl.NumberFormat("en-US").format(bet.payoutSats)} sats won`}
        </div>
      )}

      {/* Status */}
      {statusInfo && (
        <div className={`card-row-wrap text-xs ${statusInfo.color} ${statusInfo.pulse ? "animate-pulse" : ""}`}>
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
          {isDraw && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              The market ended in a draw — your stake is being returned minus the 0.5% refund fee.
            </p>
          )}
          {isRefund && !isDraw && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              No bets were placed on the opposing side — your stake is being returned minus the 0.5% refund fee.
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
              Open your Lightning wallet → Scan QR or paste LNURL → Receive {new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats
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
                    : <><Zap className="h-3.5 w-3.5" /> Send {new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats</>
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
            ? `Refund of ${new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats ready — generating link...`
            : `You won ${new Intl.NumberFormat("en-US").format(bet.payoutSats ?? 0)} sats — generating withdrawal link...`}
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
  const queries = useQueries({
    queries: hashes.map((hash) => getGetBetStatusQueryOptions(hash)),
  });

  if (hashes.length === 0) return null;

  const open: string[] = [];
  const closed: string[] = [];
  hashes.forEach((hash, i) => {
    const d = queries[i]?.data;
    const isOpen =
      !d?.status ||
      d.status === "pending" ||
      d.status === "paid" ||
      ((d.status === "won" || d.status === "refunded") && d.withdrawStatus === "unclaimed");
    if (isOpen) open.push(hash);
    else closed.push(hash);
  });

  const showSections = open.length > 0 && closed.length > 0;

  const renderCards = (group: string[]) =>
    group.map((hash) => (
      <MyBetWidget key={hash} paymentHash={hash} onDismiss={() => onDismiss(hash)} />
    ));

  return (
    <div className="card-stack">
      {showSections ? (
        <>
          <div className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Open ({open.length})
            </p>
            {renderCards(open)}
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Closed ({closed.length})
            </p>
            {renderCards(closed)}
          </div>
        </>
      ) : (
        <>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            My Bets ({hashes.length})
          </p>
          {renderCards(open.length > 0 ? open : closed)}
        </>
      )}
    </div>
  );
}
