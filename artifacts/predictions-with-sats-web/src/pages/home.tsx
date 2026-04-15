import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowUpCircle, ArrowDownCircle, AlertCircle,
  TrendingUp, TrendingDown,
  Clock, QrCode, Trophy, ShieldCheck, Wallet,
} from "lucide-react";
import { BetModal } from "@/components/bet-modal";
import {
  MyBetsList,
  getBetHashesForAsset,
  removeBetHashForAsset,
  saveBetHashForAsset,
} from "@/components/my-bet-widget";
import { GuidePager } from "@/components/guide-pager";
import { ErrorState, LoadingState } from "@/components/query-state";
import { SiBitcoin, SiEthereum, SiSolana } from "react-icons/si";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, ReferenceLine, Tooltip, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { History } from "@/pages/history";
import { getPoolMultiple } from "@/lib/payout-preview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CryptoKey = "bitcoin" | "ethereum" | "solana";
type ContentTab = "guide" | "live" | "myBets" | "history";
type AssetParam = "btc" | "eth" | "sol";

interface PricePoint { time: number; price: number }
interface CustomDotProps { cx?: number; cy?: number; index?: number; dataLength?: number }

// ---------------------------------------------------------------------------
// Asset definitions
// ---------------------------------------------------------------------------

interface CryptoDef {
  key: CryptoKey;
  asset: AssetParam;
  label: string;
  symbol: string;
  Icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  chipActive: string;
  chartColor: string;
  gradientId: string;
  dotColor: string;
  cardTint: string;
}

const CRYPTOS: CryptoDef[] = [
  {
    key: "bitcoin",
    asset: "btc",
    label: "Bitcoin",
    symbol: "₿",
    Icon: SiBitcoin,
    bgColor: "bg-orange-500",
    chipActive: "bg-yellow-400/20 text-yellow-300 border-yellow-400/50",
    chartColor: "#f97316",
    gradientId: "priceGradBtc",
    dotColor: "#f97316",
    cardTint: "surface-tint-orange",
  },
  {
    key: "ethereum",
    asset: "eth",
    label: "Ethereum",
    symbol: "Ξ",
    Icon: SiEthereum,
    bgColor: "bg-indigo-500",
    chipActive: "bg-indigo-400/20 text-indigo-300 border-indigo-400/50",
    chartColor: "#818cf8",
    gradientId: "priceGradEth",
    dotColor: "#818cf8",
    cardTint: "surface-tint-indigo",
  },
  {
    key: "solana",
    asset: "sol",
    label: "Solana",
    symbol: "◎",
    Icon: SiSolana,
    bgColor: "bg-purple-500",
    chipActive: "bg-purple-400/20 text-purple-300 border-purple-400/50",
    chartColor: "#a855f7",
    gradientId: "priceGradSol",
    dotColor: "#a855f7",
    cardTint: "surface-tint-purple",
  },
];

// ---------------------------------------------------------------------------
// Guide (generic for all crypto assets)
// ---------------------------------------------------------------------------

const GUIDE_STEPS = [
  {
    icon: SiBitcoin,
    color: "text-orange-400",
    iconBg: "bg-orange-400/15 border-orange-400/40",
    cardTint: "bg-orange-400/5",
    cardBorder: "border-orange-400/30",
    title: "What is Crypto Prediction?",
    body: "Every 5 minutes a new betting window opens. Predict whether the price will be higher (UP) or lower (DOWN) when the window closes. Winners split the entire pool minus a 2% fee — no accounts, no sign-ups.",
  },
  {
    icon: Clock,
    color: "text-blue-400",
    iconBg: "bg-blue-400/15 border-blue-400/40",
    cardTint: "bg-blue-400/5",
    cardBorder: "border-blue-400/30",
    title: "5-Minute Windows",
    body: "Windows open on exact UTC minute marks (:00, :05, :10 … :55) and close 5 minutes later. A live countdown shows how much time remains. Bets are locked in the last 30 seconds.",
  },
  {
    icon: ArrowUpCircle,
    color: "text-green-400",
    iconBg: "bg-green-400/15 border-green-400/40",
    cardTint: "bg-green-400/5",
    cardBorder: "border-green-400/30",
    title: "Bet UP or DOWN",
    body: "Tap BET UP if you think the price will close higher than the opening price. Tap BET DOWN if you think it will close lower. The pool bar shows how many sats are on each side — a minority position means a higher payout if correct.",
  },
  {
    icon: Wallet,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Enter Amount & Pay",
    body: "Minimum is $0.50 USD. After choosing a direction, enter the amount and tap Generate Invoice. Scan the QR code with any Lightning wallet (Phoenix, Alby, Wallet of Satoshi…) or click Pay with WebLN.",
  },
  {
    icon: TrendingUp,
    color: "text-cyan-400",
    iconBg: "bg-cyan-400/15 border-cyan-400/40",
    cardTint: "bg-cyan-400/5",
    cardBorder: "border-cyan-400/30",
    title: "Settlement",
    body: "When the window closes, the live price freezes and is compared to the opening price:\n• UP wins — final > opening\n• DOWN wins — final < opening\n• DRAW — price unchanged; all bettors split the pool",
  },
  {
    icon: Trophy,
    color: "text-yellow-400",
    iconBg: "bg-yellow-400/15 border-yellow-400/40",
    cardTint: "bg-yellow-400/5",
    cardBorder: "border-yellow-400/30",
    title: "Claim Your Winnings",
    body: "If you won, a QR code appears on your bet card. Scan it with any Lightning wallet (LNURL-Withdraw) to receive your sats automatically. Payouts expire 30 days after the bet.",
  },
  {
    icon: ShieldCheck,
    color: "text-emerald-400",
    iconBg: "bg-emerald-400/15 border-emerald-400/40",
    cardTint: "bg-emerald-400/5",
    cardBorder: "border-emerald-400/30",
    title: "Fees & Edge Cases",
    body: "2% house fee on normal settlements.\n• No opposing bets — your stake returns as REFUND minus a 0.5% refund fee.\n• Keep your preimage — you can verify your bet manually via the preimage field.\n• Unpaid invoices expire when the window closes.",
  },
  {
    icon: QrCode,
    color: "text-purple-400",
    iconBg: "bg-purple-400/15 border-purple-400/40",
    cardTint: "bg-purple-400/5",
    cardBorder: "border-purple-400/30",
    title: "Find Your Bet Later",
    body: "All bets placed in the current session appear in My Bets. If you change devices, use the global My Bets page to import a past bet with your payment hash or preimage.",
  },
];

function CryptoGuide({ def, onDone }: { def: CryptoDef; onDone?: () => void }) {
  const guideSteps = GUIDE_STEPS.map((step, index) => (
    index === 0
      ? {
          ...step,
          icon: TrendingUp,
        }
      : step
  ));

  return (
    <GuidePager
      steps={guideSteps}
      onDone={onDone}
      header={
        <>
          <div className={`w-7 h-7 rounded-lg ${def.bgColor} flex items-center justify-center shrink-0`}>
            <def.Icon className="text-white w-4 h-4" />
          </div>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider">{def.label} Betting Guide</h2>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CurrentPriceDot({ cx, cy, index, dataLength }: CustomDotProps) {
  if (index !== (dataLength ?? 0) - 1 || cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={5} fill="#f97316" stroke="#fff" strokeWidth={2} />;
}

// ---------------------------------------------------------------------------
// Fetch helper for market data (supports ?asset=btc|eth|sol)
// ---------------------------------------------------------------------------

interface MarketData {
  windowId: number | null;
  status: string;
  btcPriceUsd: number;
  openPrice: number | null;
  secondsRemaining: number;
  totalUpSats: number;
  totalDownSats: number;
  closesAt: string | null;
}

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

async function fetchMarket(asset: AssetParam): Promise<MarketData> {
  const res = await fetch(`${API_BASE}/api/market/current?asset=${asset}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<MarketData>;
}

// ---------------------------------------------------------------------------
// Crypto Prediction Component
// ---------------------------------------------------------------------------

function CryptoPrediction({
  def,
  onShowGuide,
}: {
  def: CryptoDef;
  onShowGuide: () => void;
}) {
  const { data: market, isLoading, error, refetch } = useQuery<MarketData>({
    queryKey: ["/api/market/current", def.asset],
    queryFn: () => fetchMarket(def.asset),
    refetchInterval: 3000,
  });

  const [betDirection, setBetDirection] = useState<"up" | "down" | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const priceHistory = useRef<PricePoint[]>([]);
  const lastWindowId = useRef<number | null>(null);
  const [secsLeft, setSecsLeft] = useState<number>(0);
  const [transitioning, setTransitioning] = useState(false);
  const transitionedWindowId = useRef<number | null>(null);
  const didTransitionRef = useRef(false);
  const prevSecsLeftRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      market?.windowId != null &&
      transitionedWindowId.current !== null &&
      market.windowId !== transitionedWindowId.current
    ) {
      setTransitioning(false);
      didTransitionRef.current = false;
      transitionedWindowId.current = null;
    }
  }, [market?.windowId]);

  useEffect(() => {
    if (market && !didTransitionRef.current) setSecsLeft(market.secondsRemaining ?? 0);
  }, [market?.secondsRemaining, market?.windowId]);

  useEffect(() => {
    const id = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (
      secsLeft === 0 && prevSecsLeftRef.current !== null && prevSecsLeftRef.current > 0 &&
      !didTransitionRef.current && market?.windowId != null
    ) {
      didTransitionRef.current = true;
      transitionedWindowId.current = market.windowId;
      setTransitioning(true);
      priceHistory.current = [];
      setPricePoints([]);
      void refetch();
    }
    prevSecsLeftRef.current = secsLeft;
  }, [secsLeft]);

  useEffect(() => {
    if (!market || !market.btcPriceUsd || market.status === "none") return;
    if (lastWindowId.current !== (market.windowId ?? null)) {
      priceHistory.current = [];
      lastWindowId.current = market.windowId ?? null;
    }
    const last = priceHistory.current[priceHistory.current.length - 1];
    if (!last || last.price !== market.btcPriceUsd) {
      priceHistory.current = [...priceHistory.current, { time: Date.now(), price: market.btcPriceUsd }];
      setPricePoints([...priceHistory.current]);
    }
  }, [market]);

  if (isLoading || !market) {
    if (error) {
      return (
        <ErrorState
          title="FAILED TO LOAD MARKET DATA"
          description={error instanceof Error ? error.message : "Unknown network error"}
          onRetry={() => void refetch()}
          cardClassName="border-red-400/20 bg-background/60"
        />
      );
    }

    return <LoadingState label="LOADING MARKET DATA..." />;
  }

  const { status, btcPriceUsd: assetPrice, openPrice, totalUpSats, totalDownSats, closesAt, windowId } = market;
  const nextClosesAtMs = closesAt ? new Date(closesAt).getTime() + 5 * 60 * 1000 : null;
  const displayWindowId  = transitioning ? (windowId ?? 0) + 1 : windowId;
  const displayClosesAt  = transitioning && nextClosesAtMs ? new Date(nextClosesAtMs).toISOString() : closesAt;
  const displayOpenPrice = transitioning ? null : openPrice;
  const displayUpSats    = transitioning ? 0 : totalUpSats;
  const displayDownSats  = transitioning ? 0 : totalDownSats;
  const displaySecsLeft  = transitioning ? 300 : secsLeft;
  const isClosed         = transitioning ? false : (status === "closed" || secsLeft < 30);
  const isNone           = transitioning ? false : status === "none";
  const totalSats        = displayUpSats + displayDownSats;
  const upPercent        = totalSats > 0 ? (displayUpSats / totalSats) * 100 : 50;
  const upMultiple       = getPoolMultiple({ selectedPoolSats: displayUpSats, totalPoolSats: totalSats });
  const downMultiple     = getPoolMultiple({ selectedPoolSats: displayDownSats, totalPoolSats: totalSats });
  const canShowUpReturn  = displayDownSats > 0;
  const canShowDownReturn = displayUpSats > 0;
  const priceChangeDollar = displayOpenPrice ? assetPrice - displayOpenPrice : 0;
  const priceChangeAbs   = Math.abs(priceChangeDollar);
  const priceUp          = priceChangeDollar > 0;
  const priceDown        = priceChangeDollar < 0;

  const formatSats = (sats: number) => new Intl.NumberFormat("en-US").format(sats);
  const formatUsd  = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatReturnPercent = (poolMultiple: number | null) => {
    if (!poolMultiple) return null;
    const roiPct = (poolMultiple - 1) * 100;
    return `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(0)}% if win`;
  };
  const mins = Math.floor(displaySecsLeft / 60);
  const secs = displaySecsLeft % 60;

  const windowTimeLabel = (() => {
    if (!displayClosesAt) return "";
    const closeDate = new Date(displayClosesAt);
    const openDate  = new Date(closeDate.getTime() - 5 * 60 * 1000);
    return `${format(openDate, "MMM d")}, ${format(openDate, "HH:mm")}–${format(closeDate, "HH:mm")} ET`;
  })();

  const chartData = pricePoints.map((p) => ({ time: p.time, price: p.price }));
  const allPrices = [...chartData.map((d) => d.price), ...(displayOpenPrice ? [displayOpenPrice] : [])];
  const minPrice  = allPrices.length > 0 ? Math.min(...allPrices) : assetPrice - 50;
  const maxPrice  = allPrices.length > 0 ? Math.max(...allPrices) : assetPrice + 50;
  const pad       = Math.max((maxPrice - minPrice) * 0.2, 20);
  const yDomain   = [minPrice - pad, maxPrice + pad];
  const { chartColor, gradientId, dotColor } = def;

  return (
    <div className="max-w-4xl mx-auto card-stack px-0">
      {isNone ? (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-bold font-mono tracking-widest">NO ACTIVE WINDOW</h2>
          <p className="text-muted-foreground text-sm">Waiting for the next betting window to open.</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center gap-3 pb-3 border-b border-border/40">
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg ${def.bgColor} flex items-center justify-center shrink-0`}>
              <def.Icon className="text-white w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold leading-tight truncate">
                {def.label} UP or DOWN — 5 minutes
              </h1>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {windowTimeLabel}
                {displayWindowId && <span className="ml-2 opacity-50">· Window #{displayWindowId}</span>}
              </p>
            </div>
          </div>

          {/* Stats Row */}
          <div className={`grid grid-cols-3 gap-2 sm:gap-4 rounded-xl border ${def.cardTint} px-3 py-3 sm:px-5 sm:py-4`}>
            <div className="space-y-1 min-w-0">
              <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider truncate">Price to beat</p>
              <p className="text-sm sm:text-xl font-mono font-bold leading-tight truncate">
                ${displayOpenPrice ? formatUsd(displayOpenPrice) : "—"}
              </p>
            </div>
            <div className="space-y-1 text-center min-w-0">
              <div className="flex items-center justify-center gap-1">
                <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">Now</p>
                {displayOpenPrice && (
                  <span className={`flex items-center gap-0.5 text-[9px] sm:text-xs font-mono font-bold ${priceUp ? "text-green-400" : priceDown ? "text-red-400" : "text-muted-foreground"}`}>
                    {priceUp ? <TrendingUp className="h-2.5 w-2.5" /> : priceDown ? <TrendingDown className="h-2.5 w-2.5" /> : null}
                    ${formatUsd(priceChangeAbs)}
                  </span>
                )}
              </div>
              <p className="text-sm sm:text-xl font-mono font-bold leading-tight truncate" style={{ color: chartColor }}>
                ${formatUsd(assetPrice)}
              </p>
            </div>
            <div className="space-y-1 text-right min-w-0">
              <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">Time left</p>
              <div className={`flex items-baseline justify-end gap-0.5 sm:gap-1 font-mono font-bold leading-tight ${displaySecsLeft < 30 ? "text-red-500 animate-pulse" : "text-red-400"}`}>
                <span className="text-sm sm:text-xl">{String(mins).padStart(2, "0")}</span>
                <span className="text-[10px] sm:text-sm opacity-60">m</span>
                <span className="text-sm sm:text-xl">{String(secs).padStart(2, "0")}</span>
                <span className="text-[10px] sm:text-sm opacity-60">s</span>
              </div>
              <p className="text-[9px] sm:text-[10px] font-mono text-muted-foreground uppercase truncate">
                {isClosed ? "Closed" : "Accepting"}
              </p>
            </div>
          </div>

          {/* Price Chart */}
          <div className={`border rounded-xl overflow-hidden pb-2 ${def.cardTint}`}>
            <div className="h-48 sm:h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) => format(new Date(t), "HH:mm")}
                    tick={{ fontSize: 9, fill: "#6b7280", fontFamily: "monospace" }}
                    tickLine={false} axisLine={false} minTickGap={50} />
                  <YAxis domain={yDomain}
                    tickFormatter={(v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                    tick={{ fontSize: 9, fill: "#6b7280", fontFamily: "monospace" }}
                    tickLine={false} axisLine={false} width={62} orientation="right" />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8, fontFamily: "monospace", fontSize: 11 }}
                    labelFormatter={(t) => format(new Date(t), "HH:mm:ss")}
                    formatter={(v: number) => [`$${formatUsd(v)}`, def.label]}
                    cursor={{ stroke: `${chartColor}44`, strokeWidth: 1 }} />
                  {displayOpenPrice && (
                    <ReferenceLine y={displayOpenPrice} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5}
                      label={{ value: "Target", position: "insideBottomRight", fill: "#f59e0b", fontSize: 9, fontFamily: "monospace" }} />
                  )}
                  <Area type="monotone" dataKey="price" stroke={chartColor} strokeWidth={2} fill={`url(#${gradientId})`}
                    dot={(props) => (
                      <CurrentPriceDot key={props.index} cx={props.cx} cy={props.cy} index={props.index} dataLength={chartData.length} />
                    )}
                    activeDot={{ r: 4, fill: dotColor, stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {chartData.length > 0 && (
              <div className="px-3 pt-1 flex items-center gap-2 flex-wrap">
                <div className={`w-2 h-2 rounded-full shrink-0 animate-pulse`} style={{ background: isClosed ? "#eab308" : chartColor }} />
                <span className="text-[10px] sm:text-xs font-mono" style={{ color: isClosed ? "#facc15" : chartColor }}>
                  {isClosed ? "Settling" : "Live"}: ${formatUsd(assetPrice)}
                </span>
                {displayOpenPrice && (
                  <span className={`text-[10px] sm:text-xs font-mono ${priceUp ? "text-green-400" : priceDown ? "text-red-400" : "text-muted-foreground"}`}>
                    {priceUp ? "▲" : priceDown ? "▼" : "—"} ${formatUsd(priceChangeAbs)} from open
                  </span>
                )}
              </div>
            )}
          </div>

          {/* UP / DOWN Buttons */}
          <div className="card-grid-2">
            <Button onClick={() => setBetDirection("up")} disabled={isClosed}
              className="h-20 sm:h-24 text-lg sm:text-xl font-mono font-bold bg-green-500/10 text-green-500 border-2 border-green-500/40 hover:bg-green-500/20 hover:border-green-500 transition-all flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="h-5 w-5 sm:h-6 sm:w-6" /> BET UP
              </div>
              <span className="text-[10px] sm:text-xs font-normal opacity-70">
                {canShowUpReturn && upMultiple
                  ? `${formatSats(displayUpSats)} sats in pool · ${formatReturnPercent(upMultiple)}`
                  : `${formatSats(displayUpSats)} sats in pool`}
              </span>
            </Button>
            <Button onClick={() => setBetDirection("down")} disabled={isClosed}
              className="h-20 sm:h-24 text-lg sm:text-xl font-mono font-bold bg-red-500/10 text-red-500 border-2 border-red-500/40 hover:bg-red-500/20 hover:border-red-500 transition-all flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="h-5 w-5 sm:h-6 sm:w-6" /> BET DOWN
              </div>
              <span className="text-[10px] sm:text-xs font-normal opacity-70">
                {canShowDownReturn && downMultiple
                  ? `${formatSats(displayDownSats)} sats in pool · ${formatReturnPercent(downMultiple)}`
                  : `${formatSats(displayDownSats)} sats in pool`}
              </span>
            </Button>
          </div>

          {/* Pool Bar */}
          <div className={`rounded-xl border ${def.cardTint} px-3 sm:px-4 py-3`}>
            <div className="flex justify-between font-mono text-xs sm:text-sm mb-2">
              <span className="text-green-500 font-bold">{upPercent.toFixed(1)}% UP</span>
              <span className="text-muted-foreground text-[10px] sm:text-xs">Pool: {formatSats(totalSats)} sats</span>
              <span className="text-red-500 font-bold">{(100 - upPercent).toFixed(1)}% DOWN</span>
            </div>
            <div className="h-2 w-full bg-red-500/20 rounded-full overflow-hidden flex">
              <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{ width: `${upPercent}%` }} />
            </div>
          </div>
        </>
      )}

      {betDirection && market.windowId && (
        <BetModal isOpen={true} onClose={() => { setBetDirection(null); }}
          direction={betDirection}
          btcPriceUsd={assetPrice}
          windowId={market.windowId}
          asset={def.asset}
          totalUpSats={displayUpSats}
          totalDownSats={displayDownSats}
        />
      )}

      <button onClick={onShowGuide}
        className="w-full text-center text-[11px] text-muted-foreground/60 hover:text-muted-foreground font-mono py-1 transition-colors">
        New here? Read the guide →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Home — wrapper with crypto chips + Guide | Live | Window History tabs
// ---------------------------------------------------------------------------

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCrypto, setActiveCrypto] = useState<CryptoKey>("bitcoin");
  const [activeTab, setActiveTab] = useState<ContentTab>("live");
  const [, setBetListVersion] = useState(0);

  const def = CRYPTOS.find((c) => c.key === activeCrypto)!;
  const betHashes = getBetHashesForAsset(def.asset);

  const recoverCryptoBet = (asset: AssetParam, paymentHash: string) => {
    saveBetHashForAsset(asset, paymentHash);
    const targetCrypto = CRYPTOS.find((crypto) => crypto.asset === asset);
    if (targetCrypto && targetCrypto.key !== activeCrypto) {
      setActiveCrypto(targetCrypto.key);
    }
    setActiveTab("live");
  };

  useEffect(() => {
    const paymentHash = searchParams.get("bet")?.trim().toLowerCase();
    const asset = searchParams.get("asset");

    if (!paymentHash || !/^[0-9a-f]{64}$/.test(paymentHash)) return;
    if (asset !== "btc" && asset !== "eth" && asset !== "sol") return;

    recoverCryptoBet(asset, paymentHash);

    const next = new URLSearchParams(searchParams);
    next.delete("bet");
    next.delete("asset");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCryptoSwitch = (key: CryptoKey) => {
    setActiveCrypto(key);
    setActiveTab("live");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-0">

      {/* Crypto asset chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-3">
        {CRYPTOS.map((c) => {
          const active = c.key === activeCrypto;
          return (
            <button
              key={c.key}
              onClick={() => handleCryptoSwitch(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                active ? c.chipActive : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
              }`}
            >
              <c.Icon className="h-3.5 w-3.5" />
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Content tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40 mb-4">
        {([
          { key: "live",     label: "Markets" },
          { key: "guide",    label: "Guide" },
          { key: "myBets",   label: "My Bets" },
          { key: "history",  label: "Results" },
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

      {activeTab === "guide" && (
        <CryptoGuide
          def={def}
          onDone={() => { setActiveTab("live"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />
      )}
      {activeTab === "myBets" && (
        <div className="card-stack">
          <div className="flex items-center justify-between gap-2 pb-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {def.label} — My Bets
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <Wallet className="h-3.5 w-3.5 text-emerald-400" />
              {betHashes.length} saved
            </span>
          </div>

          {betHashes.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-background/60 p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground">
                <Wallet className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="font-mono text-sm text-foreground">No saved {def.label} bets yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bets placed in this browser for {def.label.toLowerCase()} will appear here automatically.
              </p>
            </div>
          ) : (
            <MyBetsList
              hashes={betHashes}
              onDismiss={(hash) => {
                removeBetHashForAsset(def.asset, hash);
                setBetListVersion((current) => current + 1);
              }}
            />
          )}
        </div>
      )}
      {activeTab === "live" && (
        <CryptoPrediction
          key={def.asset}
          def={def}
          onShowGuide={() => setActiveTab("guide")}
        />
      )}
      {activeTab === "history" && (
        <History asset={def.asset} />
      )}
    </div>
  );
}
