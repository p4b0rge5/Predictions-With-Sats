import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  Cloud,
  FolderOpen,
  Search,
  TrendingUp,
  Trophy,
  Wallet,
  X,
} from "lucide-react";
import {
  MyBetWidget,
  getBetHashes,
  getBetHashesForAsset,
  getSportBetHashesForKey,
  saveSportBetHashForKey,
  getSportsBetHashes,
  getSportsPolyBetHashes,
  getWeatherBetHashes,
  removeStoredBetHashEverywhere,
  saveBetHash,
  saveSportsBetHash,
  saveSportsPolyBetHash,
  saveWeatherBetHash,
} from "@/components/my-bet-widget";
import { BetRecoveryForm } from "@/components/bet-recovery-form";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/query-state";
import { useToast } from "@/hooks/use-toast";
import { SportBetStatusCard } from "@/pages/sports";
import { SportsPolyBetStatusCard } from "@/pages/sports-poly";
import { WeatherBetStatusCard } from "@/pages/weather";

type CryptoAsset = "btc" | "eth" | "sol";
type SportKey = "football" | "nba" | "nfl" | "mlb" | "mma" | "rugby";
type BetSource = "crypto" | "sports" | "sportsPoly" | "weather";

type StoredBetRef =
  | { source: "crypto"; hash: string; asset: CryptoAsset; label: string }
  | { source: "sports"; hash: string; sportKey: SportKey; label: string }
  | { source: "sportsPoly"; hash: string; label: string }
  | { source: "weather"; hash: string; label: string };

interface BetStatusSummary {
  status?: string | null;
  withdrawStatus?: string | null;
  market?: {
    sportKey?: SportKey | null;
  } | null;
}

interface BetLookupResult {
  source: BetSource | null;
  summary: BetStatusSummary | null;
  notFound: boolean;
}

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const BET_SOURCES: BetSource[] = ["crypto", "sports", "sportsPoly", "weather"];

const CRYPTO_ASSETS: { asset: CryptoAsset; label: string }[] = [
  { asset: "btc", label: "Bitcoin" },
  { asset: "eth", label: "Ethereum" },
  { asset: "sol", label: "Solana" },
];

const SPORT_KEYS: { key: SportKey; label: string }[] = [
  { key: "football", label: "Football" },
  { key: "nba", label: "NBA" },
  { key: "nfl", label: "NFL" },
  { key: "mlb", label: "MLB" },
  { key: "mma", label: "MMA" },
  { key: "rugby", label: "Rugby" },
];

function dedupeByHash<T extends { hash: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.hash)) return false;
    seen.add(item.hash);
    return true;
  });
}

function getStoredBets(): StoredBetRef[] {
  const crypto = CRYPTO_ASSETS.flatMap(({ asset, label }) =>
    getBetHashesForAsset(asset).map((hash) => ({
      source: "crypto" as const,
      hash,
      asset,
      label,
    })),
  );

  const genericCrypto = getBetHashes().map((hash) => ({
    source: "crypto" as const,
    hash,
    asset: "btc" as const,
    label: "Crypto",
  }));

  const sports = SPORT_KEYS.flatMap(({ key, label }) =>
    getSportBetHashesForKey(key).map((hash) => ({
      source: "sports" as const,
      hash,
      sportKey: key,
      label,
    })),
  );

  const genericSports = getSportsBetHashes().map((hash) => ({
    source: "sports" as const,
    hash,
    sportKey: "football" as const,
    label: "Sports",
  }));

  const sportsPoly = getSportsPolyBetHashes().map((hash) => ({
    source: "sportsPoly" as const,
    hash,
    label: "Sports+",
  }));

  const weather = getWeatherBetHashes().map((hash) => ({
    source: "weather" as const,
    hash,
    label: "Weather",
  }));

  return dedupeByHash([
    ...crypto,
    ...genericCrypto,
    ...sports,
    ...genericSports,
    ...sportsPoly,
    ...weather,
  ]);
}

function getSourceLabel(source: BetSource) {
  if (source === "crypto") return "Crypto";
  if (source === "sports") return "Sports";
  if (source === "sportsPoly") return "Sports+";
  return "Weather";
}

function getSourceEndpoint(source: BetSource, hash: string) {
  if (source === "crypto") return `${API_BASE}/api/bet/${hash}`;
  if (source === "sports") return `${API_BASE}/api/sports/bets/${hash}`;
  if (source === "sportsPoly") return `${API_BASE}/api/sports-poly/bets/${hash}`;
  return `${API_BASE}/api/weather/bets/${hash}`;
}

async function fetchStatus(ref: Pick<StoredBetRef, "source" | "hash">): Promise<BetLookupResult> {
  const sourceOrder = [ref.source, ...BET_SOURCES.filter((source) => source !== ref.source)];
  let lastError: Error | null = null;

  for (const source of sourceOrder) {
    try {
      const res = await fetch(getSourceEndpoint(source, ref.hash));
      if (res.ok) {
        return {
          source,
          summary: await res.json() as BetStatusSummary,
          notFound: false,
        };
      }

      if (res.status !== 404) {
        lastError = new Error(`HTTP ${res.status}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Failed to fetch");
    }
  }

  if (lastError) throw lastError;

  return {
    source: null,
    summary: null,
    notFound: true,
  };
}

async function sha256Hex(hexValue: string): Promise<string> {
  const bytes = Uint8Array.from(
    hexValue.match(/.{1,2}/g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function saveRecoveredHash(source: BetSource, hash: string, summary: BetStatusSummary | null = null) {
  if (source === "crypto") {
    saveBetHash(hash);
    return;
  }

  if (source === "sports") {
    const sportKey = summary?.market?.sportKey;
    if (sportKey) {
      saveSportBetHashForKey(sportKey, hash);
      return;
    }
    saveSportsBetHash(hash);
    return;
  }

  if (source === "sportsPoly") {
    saveSportsPolyBetHash(hash);
    return;
  }

  saveWeatherBetHash(hash);
}

function isOpenBet(summary: BetStatusSummary | undefined): boolean {
  if (!summary?.status) return false;

  return (
    summary.status === "pending" ||
    summary.status === "paid" ||
    ((summary.status === "won" || summary.status === "refunded") && summary.withdrawStatus === "unclaimed")
  );
}

function SourceIcon({ source }: { source: BetSource }) {
  if (source === "crypto") return <TrendingUp className="h-4 w-4 text-orange-400" />;
  if (source === "sports") return <Trophy className="h-4 w-4 text-yellow-400" />;
  if (source === "sportsPoly") return <Trophy className="h-4 w-4 text-amber-400" />;
  return <Cloud className="h-4 w-4 text-cyan-400" />;
}

function SourceBadge({ bet }: { bet: StoredBetRef }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
      <SourceIcon source={bet.source} />
      <span>{bet.label}</span>
    </div>
  );
}

function BetRenderer({
  bet,
  onDismiss,
}: {
  bet: StoredBetRef;
  onDismiss: () => void;
}) {
  if (bet.source === "crypto") {
    return <MyBetWidget paymentHash={bet.hash} onDismiss={onDismiss} />;
  }

  if (bet.source === "sports") {
    return <SportBetStatusCard hash={bet.hash} onDismiss={onDismiss} />;
  }

  if (bet.source === "sportsPoly") {
    return <SportsPolyBetStatusCard hash={bet.hash} onDismiss={onDismiss} />;
  }

  return <WeatherBetStatusCard hash={bet.hash} onDismiss={onDismiss} />;
}

function BetSection({
  title,
  description,
  icon,
  bets,
  onDismiss,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  bets: StoredBetRef[];
  onDismiss: (hash: string) => void;
}) {
  if (bets.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground">
          {icon}
        </div>
        <p className="font-mono text-sm text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    );
  }

  return (
    <section className="card-stack">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="card-stack">
        {bets.map((bet) => (
          <div key={bet.hash} className="space-y-2">
            <SourceBadge bet={bet} />
            <BetRenderer bet={bet} onDismiss={() => onDismiss(bet.hash)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function GlobalMyBets() {
  const [storedBets, setStoredBets] = useState<StoredBetRef[]>([]);
  const [isRecovering, setIsRecovering] = useState(false);
  const { toast } = useToast();

  const refreshStoredBets = () => setStoredBets(getStoredBets());

  useEffect(() => {
    refreshStoredBets();
  }, []);

  const results = useQueries({
    queries: storedBets.map((bet) => ({
      queryKey: ["global-my-bets", bet.source, bet.hash],
      queryFn: () => fetchStatus(bet),
      refetchInterval: (query: { state: { data?: BetLookupResult } }) =>
        isOpenBet(query.state.data?.summary ?? undefined) ? 10000 : false,
      retry: 1,
    })),
  });

  const hasBets = storedBets.length > 0;
  const isLoading = hasBets && results.some((query) => query.isLoading && !query.data);
  const hasBlockingError = hasBets && results.length > 0 && results.every((query) => query.isError);
  const hasPartialError = results.some((query) => query.isError);

  const resolvedBets = useMemo(
    () =>
      storedBets.flatMap((bet, index) => {
        const lookup = results[index]?.data;
        if (!lookup || lookup.notFound || !lookup.source || !lookup.summary) return [];

        const label = lookup.source === bet.source ? bet.label : getSourceLabel(lookup.source);
        const resolvedBet =
          lookup.source === "crypto"
            ? ({ source: "crypto", hash: bet.hash, asset: "btc", label } as StoredBetRef)
            : lookup.source === "sports"
              ? ({ source: "sports", hash: bet.hash, sportKey: "football", label } as StoredBetRef)
              : lookup.source === "sportsPoly"
                ? ({ source: "sportsPoly", hash: bet.hash, label } as StoredBetRef)
                : ({ source: "weather", hash: bet.hash, label } as StoredBetRef);

        return [{ bet: resolvedBet, summary: lookup.summary }];
      }),
    [storedBets, results],
  );

  const invalidBets = useMemo(
    () => storedBets.filter((_, index) => results[index]?.data?.notFound),
    [storedBets, results],
  );

  const openBets = useMemo(
    () =>
      resolvedBets
        .filter(({ summary }) => isOpenBet(summary))
        .map(({ bet }) => bet),
    [resolvedBets],
  );

  const closedBets = useMemo(
    () =>
      resolvedBets
        .filter(({ summary }) => !isOpenBet(summary))
        .map(({ bet }) => bet),
    [resolvedBets],
  );

  const dismissHash = (hash: string) => {
    removeStoredBetHashEverywhere(hash);
    refreshStoredBets();
  };

  const handleRecover = async (value: string) => {
    setIsRecovering(true);

    try {
      let resolvedHash = value;
      let resolvedLookup = await fetchStatus({ source: "crypto", hash: value });

      if (resolvedLookup.notFound) {
        resolvedHash = await sha256Hex(value);
        resolvedLookup = await fetchStatus({ source: "crypto", hash: resolvedHash });
      }

      if (resolvedLookup.notFound || !resolvedLookup.source) {
        toast({
          title: "Bet not found",
          description: "No bet matched this payment hash or preimage.",
          variant: "destructive",
        });
        return;
      }

      saveRecoveredHash(resolvedLookup.source, resolvedHash, resolvedLookup.summary);
      refreshStoredBets();
      toast({
        title: "Bet imported",
        description: `${getSourceLabel(resolvedLookup.source)} bet added to My Bets.`,
      });
    } catch (error) {
      toast({
        title: "Failed to import bet",
        description: error instanceof Error ? error.message : "Try again in a few seconds.",
        variant: "destructive",
      });
    } finally {
      setIsRecovering(false);
    }
  };

  const hasVisibleBets = openBets.length > 0 || closedBets.length > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-border/50 bg-background/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-yellow-400" />
          <h1 className="font-mono text-xl font-bold uppercase tracking-wider">My Bets</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          All bets saved in this browser, across Crypto, Sports, Sports+, and Weather. Open bets stay at the top. Settled bets remain below for reference.
        </p>
        <BetRecoveryForm
          description="Paste a 64-char payment hash or preimage. The app will detect the market type and save it here globally."
          placeholder="payment hash or preimage (64 hex chars)"
          buttonLabel={isRecovering ? "Importing..." : "Import"}
          disabled={isRecovering}
          onRecover={handleRecover}
        />
      </div>

      {!hasBets ? (
        <div className="rounded-xl border border-border/50 bg-background/60 p-8 text-center">
          <Wallet className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-mono text-sm text-foreground">No bets saved in this browser yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Place a bet in any market, or import one here by payment hash or preimage.
          </p>
        </div>
      ) : isLoading ? (
        <LoadingState label="LOADING YOUR BETS..." />
      ) : hasBlockingError ? (
        <ErrorState
          title="FAILED TO LOAD SOME BETS"
          description="Saved bet statuses could not be refreshed. Try again in a few seconds."
          onRetry={refreshStoredBets}
          cardClassName="border-red-400/20 bg-background/60"
        />
      ) : (
        <>
          {hasPartialError ? (
            <ErrorState
              title="SOME BETS COULD NOT BE REFRESHED"
              description="The list below still shows the bets that were loaded successfully."
              onRetry={refreshStoredBets}
              cardClassName="border-red-400/20 bg-background/60"
              compact
              className="h-auto justify-start px-0"
            />
          ) : null}

          {invalidBets.length > 0 ? (
            <section className="space-y-3 rounded-xl border border-amber-400/20 bg-background/60 p-4">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-amber-300" />
                <div>
                  <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-foreground">
                    Unmatched Saved Bets ({invalidBets.length})
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    These hashes were saved in this browser but were not found in any current bet endpoint.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {invalidBets.map((bet) => (
                  <div
                    key={bet.hash}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        {bet.label}
                      </p>
                      <p className="truncate font-mono text-xs text-foreground">{bet.hash}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={() => dismissHash(bet.hash)}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {hasVisibleBets ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start xl:gap-8">
              <BetSection
                title={`Open Bets (${openBets.length})`}
                description="Pending, active, or ready to claim."
                icon={<FolderOpen className="h-4 w-4 text-yellow-400" />}
                bets={openBets}
                onDismiss={dismissHash}
              />
              <BetSection
                title={`Closed Bets (${closedBets.length})`}
                description="Settled, claimed, lost, expired, or otherwise finished."
                icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
                bets={closedBets}
                onDismiss={dismissHash}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-border/50 bg-background/60 p-8 text-center">
              <Wallet className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-mono text-sm text-foreground">No valid bets could be loaded right now</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You can remove unmatched hashes above or try importing the correct payment hash/preimage again.
              </p>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        Saved bets are stored per browser. If you switch device or public URL, recover them here by payment hash or preimage.
      </div>
    </div>
  );
}
