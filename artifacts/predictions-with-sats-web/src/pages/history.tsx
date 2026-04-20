import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "@/components/query-state";
import { format } from "date-fns";
import { ArrowUpRight, ArrowDownRight, Minus, Clock } from "lucide-react";

type AssetParam = "btc" | "eth" | "sol" | "xrp" | "bnb";

interface HistoryItem {
  id: number;
  outcome: string | null;
  openPrice: number | null;
  closePrice: number | null;
  priceChangePercent: number | null;
  totalUpSats: number;
  totalDownSats: number;
  openedAt: string;
  settledAt: string | null;
}

interface CurrentMarketItem {
  windowId: number | null;
  status: string;
  btcPriceUsd: number;
  openPrice: number | null;
  secondsRemaining: number;
  totalUpSats: number;
  totalDownSats: number;
  closesAt: string | null;
}

const ASSET_CARD_TINT: Record<AssetParam, string> = {
  btc: "surface-tint-orange",
  eth: "surface-tint-indigo",
  sol: "surface-tint-purple",
  xrp: "surface-tint-blue",
  bnb: "surface-tint-yellow",
};

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

async function fetchHistory(asset: AssetParam, intervalMins: number): Promise<HistoryItem[]> {
  const res = await fetch(`${API_BASE}/api/market/history?limit=50&asset=${asset}&interval=${intervalMins}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<HistoryItem[]>;
}

async function fetchCurrentMarket(asset: AssetParam, intervalMins: number): Promise<CurrentMarketItem> {
  const res = await fetch(`${API_BASE}/api/market/current?asset=${asset}&interval=${intervalMins}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CurrentMarketItem>;
}

function HistoryCard({
  item,
  cardTint,
  intervalMins,
}: {
  item: HistoryItem;
  cardTint: string;
  intervalMins: number;
}) {
  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatSats = (sats: number) => new Intl.NumberFormat("en-US").format(sats);

  const DirectionBadge = ({ pct }: { pct?: number | null }) => {
    if (pct == null) return null;
    if (pct > 0)
      return (
        <span className="inline-flex items-center text-green-500 font-bold bg-green-500/10 px-2 py-0.5 rounded text-xs font-mono">
          <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> UP
        </span>
      );
    if (pct < 0)
      return (
        <span className="inline-flex items-center text-red-500 font-bold bg-red-500/10 px-2 py-0.5 rounded text-xs font-mono">
          <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" /> DOWN
        </span>
      );
    return (
      <span className="inline-flex items-center text-yellow-500 font-bold bg-yellow-500/10 px-2 py-0.5 rounded text-xs font-mono">
        <Minus className="h-3.5 w-3.5 mr-0.5" /> DRAW
      </span>
    );
  };

  const OutcomeBadge = ({ outcome, priceChangePercent }: { outcome?: string | null; priceChangePercent?: number | null }) => {
    if (outcome === "up")
      return (
        <span className="inline-flex items-center text-green-500 font-bold bg-green-500/10 px-2 py-0.5 rounded text-xs font-mono">
          <ArrowUpRight className="h-3.5 w-3.5 mr-0.5" /> UP
        </span>
      );
    if (outcome === "down")
      return (
        <span className="inline-flex items-center text-red-500 font-bold bg-red-500/10 px-2 py-0.5 rounded text-xs font-mono">
          <ArrowDownRight className="h-3.5 w-3.5 mr-0.5" /> DOWN
        </span>
      );
    if (outcome === "draw")
      return (
        <span className="inline-flex items-center text-yellow-500 font-bold bg-yellow-500/10 px-2 py-0.5 rounded text-xs font-mono">
          <Minus className="h-3.5 w-3.5 mr-0.5" /> DRAW
        </span>
      );
    if (outcome === "no_liquidity")
      return (
        <span className="inline-flex items-center gap-1">
          <DirectionBadge pct={priceChangePercent} />
          <span className="inline-flex items-center text-blue-400 font-bold bg-blue-400/10 px-2 py-0.5 rounded text-xs font-mono">
            <Minus className="h-3.5 w-3.5 mr-0.5" /> REFUND
          </span>
        </span>
      );
    return <span className="text-muted-foreground text-xs font-mono">PENDING</span>;
  };

  const totalSats = item.totalUpSats + item.totalDownSats;
  const isUp = item.outcome === "up";
  const isDown = item.outcome === "down";
  const changeColor = isUp ? "text-green-500" : isDown ? "text-red-500" : "text-muted-foreground";

  return (
    <div
      className={`rounded-xl border ${cardTint} card-safe px-4 py-3 font-mono flex h-full flex-col gap-2.5`}
      data-testid={`row-history-${item.id}`}
    >
      <div className="card-row-between-wrap">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">
            {format(new Date(item.openedAt), "MMM d, HH:mm")}–{format(new Date(new Date(item.openedAt).getTime() + intervalMins * 60 * 1000), "HH:mm")}
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-mono">Window #{item.id}</span>
        </div>
        <OutcomeBadge outcome={item.outcome} priceChangePercent={item.priceChangePercent} />
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</p>
          <p className="text-sm font-bold leading-tight">${item.openPrice ? formatUsd(item.openPrice) : "—"}</p>
        </div>
        <span className="text-muted-foreground shrink-0 text-lg leading-none">→</span>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Close</p>
          <p className="text-sm font-bold leading-tight">${item.closePrice ? formatUsd(item.closePrice) : "—"}</p>
        </div>
      </div>

      <div className="mt-auto card-row-between-wrap text-xs">
        {item.priceChangePercent != null ? (
          <span className={`font-bold ${changeColor}`}>
            {item.priceChangePercent > 0 ? "+" : ""}
            {item.priceChangePercent.toFixed(3)}%
          </span>
        ) : <span />}
        {totalSats > 0 && (
          <span className="text-muted-foreground">Pool: {formatSats(totalSats)} sats</span>
        )}
      </div>
    </div>
  );
}

function PendingHistoryCard({ item, cardTint, intervalMins }: { item: CurrentMarketItem; cardTint: string; intervalMins: number }) {
  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatSats = (sats: number) => new Intl.NumberFormat("en-US").format(sats);
  const openedAt = item.closesAt ? new Date(new Date(item.closesAt).getTime() - intervalMins * 60 * 1000) : null;
  const totalSats = item.totalUpSats + item.totalDownSats;

  return (
    <div className={`rounded-xl border ${cardTint} card-safe px-4 py-3 font-mono flex h-full flex-col gap-2.5`}>
      <div className="card-row-between-wrap">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">
            {openedAt && item.closesAt
              ? `${format(openedAt, "MMM d, HH:mm")}–${format(new Date(item.closesAt), "HH:mm")}`
              : "Current window"}
          </span>
          <span className="text-[10px] text-muted-foreground/50 font-mono">Window #{item.windowId ?? "—"}</span>
        </div>
        <span className="inline-flex items-center text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded text-xs font-mono">
          <Clock className="h-3.5 w-3.5 mr-0.5" /> SETTLING
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</p>
          <p className="text-sm font-bold leading-tight">${item.openPrice ? formatUsd(item.openPrice) : "—"}</p>
        </div>
        <span className="text-muted-foreground shrink-0 text-lg leading-none">→</span>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last price</p>
          <p className="text-sm font-bold leading-tight">${formatUsd(item.btcPriceUsd)}</p>
        </div>
      </div>

      <div className="mt-auto card-row-between-wrap text-xs">
        <span className="text-amber-300">Window closed, waiting for settlement</span>
        {totalSats > 0 && (
          <span className="text-muted-foreground">Pool: {formatSats(totalSats)} sats</span>
        )}
      </div>
    </div>
  );
}

export function History({ asset = "btc", intervalMins = 5 }: { asset?: AssetParam; intervalMins?: 5 | 15 | 30 }) {
  const { data: history, isLoading, error, refetch } = useQuery<HistoryItem[]>({
    queryKey: ["/api/market/history", asset, intervalMins],
    queryFn: () => fetchHistory(asset, intervalMins),
    refetchInterval: 15000,
  });
  const { data: currentMarket } = useQuery<CurrentMarketItem>({
    queryKey: ["/api/market/current", asset, intervalMins, "history-results"],
    queryFn: () => fetchCurrentMarket(asset, intervalMins),
    refetchInterval: 3000,
    retry: 1,
  });

  const cardTint = ASSET_CARD_TINT[asset];
  const pendingCurrentWindow =
    currentMarket?.status === "closed" &&
    currentMarket.windowId !== null &&
    !history?.some((item) => item.id === currentMarket.windowId)
      ? currentMarket
      : null;

  if (isLoading) {
    return <LoadingState label="LOADING HISTORY..." />;
  }

  if (error) {
    return (
      <ErrorState
        title="FAILED TO LOAD HISTORY"
        description={error instanceof Error ? error.message : "Unknown network error"}
        onRetry={() => void refetch()}
        cardClassName={cardTint}
      />
    );
  }

  const emptyState = !history?.length && !pendingCurrentWindow;

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
      <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">Window History</h1>

      {emptyState ? (
        <div className={`rounded-xl border ${cardTint} h-32 flex items-center justify-center text-muted-foreground font-mono text-sm`}>
          No history available
        </div>
      ) : (
        <div className="card-grid-2">
          {pendingCurrentWindow && <PendingHistoryCard item={pendingCurrentWindow} cardTint={cardTint} intervalMins={intervalMins} />}
          {history!.map((item) => (
            <HistoryCard key={item.id} item={item} cardTint={cardTint} intervalMins={intervalMins} />
          ))}
        </div>
      )}
    </div>
  );
}
