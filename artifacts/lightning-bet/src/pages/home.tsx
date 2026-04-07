import { useGetCurrentMarket, getGetCurrentMarketQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowUpCircle, ArrowDownCircle, AlertCircle, TrendingUp, TrendingDown, Search, ChevronDown, ChevronUp } from "lucide-react";
import { BetModal } from "@/components/bet-modal";
import { MyBetsList, getBetHashes, removeBetHash } from "@/components/my-bet-widget";
import { useState, useEffect, useRef } from "react";
import { SiBitcoin } from "react-icons/si";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format } from "date-fns";

interface PricePoint {
  time: number;
  price: number;
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  dataLength?: number;
}

function CurrentPriceDot({ cx, cy, index, dataLength }: CustomDotProps) {
  if (index !== (dataLength ?? 0) - 1 || cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={5} fill="#f97316" stroke="#fff" strokeWidth={2} />;
}

export function Home() {
  // Refetch every 3 s for responsive price/chart updates
  const { data: market, isLoading } = useGetCurrentMarket({
    query: { refetchInterval: 3000, queryKey: getGetCurrentMarketQueryKey() },
  });
  const [betDirection, setBetDirection] = useState<"up" | "down" | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const priceHistory = useRef<PricePoint[]>([]);
  const lastWindowId = useRef<number | null>(null);
  const [betHashes, setBetHashes] = useState<string[]>([]);
  const [lookupHash, setLookupHash] = useState("");
  const [lookedUpHash, setLookedUpHash] = useState<string | null>(null);
  const [showLookup, setShowLookup] = useState(false);

  // ── 1-second countdown ──────────────────────────────────────────────────────
  const [secsLeft, setSecsLeft] = useState<number>(0);

  // Sync countdown whenever fresh server data arrives
  useEffect(() => {
    if (market) setSecsLeft(market.secondsRemaining ?? 0);
  }, [market?.secondsRemaining, market?.windowId]);

  // Local 1-second ticker — decrement until zero
  useEffect(() => {
    const id = setInterval(() => {
      setSecsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  // ────────────────────────────────────────────────────────────────────────────


  useEffect(() => {
    setBetHashes(getBetHashes());
  }, []);

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
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="font-mono text-muted-foreground tracking-widest text-sm">LOADING MARKET DATA...</p>
        </div>
      </div>
    );
  }

  const { status, btcPriceUsd, openPrice, totalUpSats, totalDownSats, closesAt, windowId } = market;

  const isClosed = status === "closed" || secsLeft < 30;
  const isNone = status === "none";

  const totalSats = totalUpSats + totalDownSats;
  const upPercent = totalSats > 0 ? (totalUpSats / totalSats) * 100 : 50;

  const priceChangeDollar = openPrice ? btcPriceUsd - openPrice : 0;
  const priceChangeAbs = Math.abs(priceChangeDollar);
  const priceUp = priceChangeDollar > 0;
  const priceDown = priceChangeDollar < 0;

  const formatSats = (sats: number) => new Intl.NumberFormat().format(sats);
  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;

  const windowTimeLabel = (() => {
    if (!closesAt) return "";
    const closeDate = new Date(closesAt);
    const openDate = new Date(closeDate.getTime() - 5 * 60 * 1000);
    return `${format(openDate, "MMM d")}, ${format(openDate, "HH:mm")}–${format(closeDate, "HH:mm")} ET`;
  })();

  const chartData = pricePoints.map((p) => ({ time: p.time, price: p.price }));

  const allPrices = [...chartData.map((d) => d.price), ...(openPrice ? [openPrice] : [])];
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : btcPriceUsd - 50;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : btcPriceUsd + 50;
  const pad = Math.max((maxPrice - minPrice) * 0.2, 20);
  const yDomain = [minPrice - pad, maxPrice + pad];

  return (
    <div className="max-w-3xl mx-auto space-y-4 px-0">
      {isNone ? (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-bold font-mono tracking-widest">NO ACTIVE WINDOW</h2>
          <p className="text-muted-foreground text-sm">Waiting for the next betting window to open.</p>
        </div>
      ) : (
        <>
          {/* ── Header ── */}
          <div className="flex items-center gap-3 pb-3 border-b border-border/40">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-orange-500 flex items-center justify-center shrink-0">
              <SiBitcoin className="text-white w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold leading-tight truncate">
                Bitcoin UP or DOWN — 5 minutes
              </h1>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {windowTimeLabel}
                {windowId && <span className="ml-2 opacity-50">· Window #{windowId}</span>}
              </p>
            </div>
          </div>

          {/* ── Stats Row — 3-column grid on all screen sizes ── */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 rounded-xl bg-card/30 border border-border/40 px-3 py-3 sm:px-5 sm:py-4">
            {/* Price to beat */}
            <div className="space-y-1 min-w-0">
              <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider truncate">
                Price to beat
              </p>
              <p className="text-sm sm:text-xl font-mono font-bold leading-tight truncate" data-testid="text-open-price">
                ${openPrice ? formatUsd(openPrice) : "—"}
              </p>
            </div>

            {/* Current price — center column */}
            <div className="space-y-1 text-center min-w-0">
              <div className="flex items-center justify-center gap-1">
                <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">
                  Now
                </p>
                {openPrice && (
                  <span
                    className={`flex items-center gap-0.5 text-[9px] sm:text-xs font-mono font-bold ${
                      priceUp ? "text-green-400" : priceDown ? "text-red-400" : "text-muted-foreground"
                    }`}
                  >
                    {priceUp ? <TrendingUp className="h-2.5 w-2.5" /> : priceDown ? <TrendingDown className="h-2.5 w-2.5" /> : null}
                    ${formatUsd(priceChangeAbs)}
                  </span>
                )}
              </div>
              <p
                className="text-sm sm:text-xl font-mono font-bold text-orange-400 leading-tight truncate"
                data-testid="text-btc-price"
              >
                ${formatUsd(btcPriceUsd)}
              </p>
            </div>

            {/* Countdown — right column */}
            <div className="space-y-1 text-right min-w-0">
              <p className="text-[9px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Time left
              </p>
              <div
                className={`flex items-baseline justify-end gap-0.5 sm:gap-1 font-mono font-bold leading-tight ${
                  secsLeft < 30 ? "text-red-500 animate-pulse" : "text-red-400"
                }`}
                data-testid="text-countdown"
              >
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

          {/* ── Price Chart ── */}
          <div className="border border-border/40 rounded-xl overflow-hidden bg-card/30 pb-2">
            <div className="h-48 sm:h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) => format(new Date(t), "HH:mm")}
                    tick={{ fontSize: 9, fill: "#6b7280", fontFamily: "monospace" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={50}
                  />
                  <YAxis
                    domain={yDomain}
                    tickFormatter={(v) =>
                      `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    }
                    tick={{ fontSize: 9, fill: "#6b7280", fontFamily: "monospace" }}
                    tickLine={false}
                    axisLine={false}
                    width={62}
                    orientation="right"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#111",
                      border: "1px solid #333",
                      borderRadius: 8,
                      fontFamily: "monospace",
                      fontSize: 11,
                    }}
                    labelFormatter={(t) => format(new Date(t), "HH:mm:ss")}
                    formatter={(v: number) => [`$${formatUsd(v)}`, "BTC"]}
                    cursor={{ stroke: "rgba(249,115,22,0.3)", strokeWidth: 1 }}
                  />
                  {openPrice && (
                    <ReferenceLine
                      y={openPrice}
                      stroke="#f59e0b"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{
                        value: "Target",
                        position: "insideBottomRight",
                        fill: "#f59e0b",
                        fontSize: 9,
                        fontFamily: "monospace",
                      }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="url(#priceGrad)"
                    dot={(props) => (
                      <CurrentPriceDot
                        key={props.index}
                        cx={props.cx}
                        cy={props.cy}
                        index={props.index}
                        dataLength={chartData.length}
                      />
                    )}
                    activeDot={{ r: 4, fill: "#f97316", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {chartData.length > 0 && (
              <div className="px-3 pt-1 flex items-center gap-2 flex-wrap">
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isClosed ? "bg-yellow-500 animate-pulse" : "bg-orange-500 animate-pulse"
                  }`}
                />
                <span
                  className={`text-[10px] sm:text-xs font-mono ${
                    isClosed ? "text-yellow-400" : "text-orange-400"
                  }`}
                >
                  {isClosed ? "Settling" : "Live"}: ${formatUsd(btcPriceUsd)}
                </span>
                {openPrice && (
                  <span
                    className={`text-[10px] sm:text-xs font-mono ${
                      priceUp ? "text-green-400" : priceDown ? "text-red-400" : "text-muted-foreground"
                    }`}
                  >
                    {priceUp ? "▲" : priceDown ? "▼" : "—"} ${formatUsd(priceChangeAbs)} from open
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── UP / DOWN Buttons ── */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => setBetDirection("up")}
              disabled={isClosed}
              className="h-20 sm:h-24 text-lg sm:text-xl font-mono font-bold bg-green-500/10 text-green-500 border-2 border-green-500/40 hover:bg-green-500/20 hover:border-green-500 transition-all flex flex-col gap-1"
              data-testid="button-bet-up"
            >
              <div className="flex items-center gap-2">
                <ArrowUpCircle className="h-5 w-5 sm:h-6 sm:w-6" />
                BET UP
              </div>
              <span className="text-[10px] sm:text-xs font-normal opacity-70">
                {formatSats(totalUpSats)} sats in pool
              </span>
            </Button>

            <Button
              onClick={() => setBetDirection("down")}
              disabled={isClosed}
              className="h-20 sm:h-24 text-lg sm:text-xl font-mono font-bold bg-red-500/10 text-red-500 border-2 border-red-500/40 hover:bg-red-500/20 hover:border-red-500 transition-all flex flex-col gap-1"
              data-testid="button-bet-down"
            >
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="h-5 w-5 sm:h-6 sm:w-6" />
                BET DOWN
              </div>
              <span className="text-[10px] sm:text-xs font-normal opacity-70">
                {formatSats(totalDownSats)} sats in pool
              </span>
            </Button>
          </div>

          {/* ── Pool Bar ── */}
          <div className="rounded-xl bg-card/30 border border-border/40 px-3 sm:px-4 py-3">
            <div className="flex justify-between font-mono text-xs sm:text-sm mb-2">
              <span className="text-green-500 font-bold">{upPercent.toFixed(1)}% UP</span>
              <span className="text-muted-foreground text-[10px] sm:text-xs">Pool: {formatSats(totalSats)} sats</span>
              <span className="text-red-500 font-bold">{(100 - upPercent).toFixed(1)}% DOWN</span>
            </div>
            <div className="h-2 w-full bg-red-500/20 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-700"
                style={{ width: `${upPercent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── My Bets — chronological list of all bets ── */}
      <MyBetsList
        hashes={betHashes}
        onDismiss={(hash) => {
          removeBetHash(hash);
          setBetHashes(getBetHashes());
        }}
      />

      {/* ── Manual bet lookup by hash ── */}
      <div className="rounded-xl border border-border/40 bg-card/20 font-mono overflow-hidden">
        <button
          onClick={() => setShowLookup(v => !v)}
          className="w-full px-4 py-3 flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Search className="h-3 w-3" /> Look up bet by hash
          </span>
          {showLookup ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showLookup && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-[10px] text-muted-foreground">
              Paste a 64-char payment hash to look up a bet result.
            </p>
            <div className="flex gap-2">
              <Input
                value={lookupHash}
                onChange={e => setLookupHash(e.target.value.trim().toLowerCase())}
                placeholder="payment hash (64 hex chars)"
                className="font-mono text-xs h-8"
              />
              <Button
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={lookupHash.length !== 64}
                onClick={() => {
                  setLookedUpHash(lookupHash);
                  setShowLookup(false);
                  setLookupHash("");
                }}
              >
                Search
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Resultado da busca manual */}
      {lookedUpHash && (
        <MyBetsList
          hashes={[lookedUpHash]}
          onDismiss={() => {
            setLookedUpHash(null);
          }}
        />
      )}

      {betDirection && market.windowId && (
        <BetModal
          isOpen={true}
          onClose={() => {
            setBetDirection(null);
            setBetHashes(getBetHashes());
          }}
          direction={betDirection}
          btcPriceUsd={btcPriceUsd}
          windowId={market.windowId}
        />
      )}
    </div>
  );
}
