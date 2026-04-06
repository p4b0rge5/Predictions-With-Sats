import { useGetCurrentMarket, getGetCurrentMarketQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowUpCircle, ArrowDownCircle, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { BetModal } from "@/components/bet-modal";
import { MyBetWidget, getLastBetHash, clearLastBetHash } from "@/components/my-bet-widget";
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
  const { data: market, isLoading } = useGetCurrentMarket({
    query: { refetchInterval: 10000, queryKey: getGetCurrentMarketQueryKey() },
  });
  const [betDirection, setBetDirection] = useState<"up" | "down" | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const priceHistory = useRef<PricePoint[]>([]);
  const lastWindowId = useRef<number | null>(null);
  const [lastBetHash, setLastBetHash] = useState<string | null>(null);

  useEffect(() => {
    setLastBetHash(getLastBetHash());
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

  const { status, btcPriceUsd, openPrice, secondsRemaining, totalUpSats, totalDownSats, closesAt } = market;

  const isClosed = status === "closed" || secondsRemaining < 30;
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

  const mins = Math.floor(Math.max(0, secondsRemaining) / 60);
  const secs = Math.max(0, secondsRemaining) % 60;

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
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{windowTimeLabel}</p>
            </div>
          </div>

          {/* ── Stats Row — responsive ── */}
          {/* Mobile: 2×2 grid. Desktop: 3-column flex */}
          <div className="grid grid-cols-2 sm:flex sm:items-start sm:justify-between gap-3">
            {/* Price to beat */}
            <div className="space-y-0.5">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Price to beat
              </p>
              <p className="text-lg sm:text-2xl font-mono font-bold" data-testid="text-open-price">
                ${openPrice ? formatUsd(openPrice) : "—"}
              </p>
            </div>

            {/* Countdown — top-right on mobile */}
            <div className="text-right sm:order-last space-y-0.5">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Time left
              </p>
              <div
                className={`flex items-end gap-2 sm:gap-3 justify-end font-mono font-bold ${
                  secondsRemaining < 30 ? "text-red-500 animate-pulse" : "text-red-400"
                }`}
                data-testid="text-countdown"
              >
                <div className="text-center">
                  <div className="text-3xl sm:text-4xl leading-none">{String(mins).padStart(2, "0")}</div>
                  <div className="text-[9px] sm:text-[10px] tracking-widest text-muted-foreground mt-0.5">MIN</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl sm:text-4xl leading-none">{String(secs).padStart(2, "0")}</div>
                  <div className="text-[9px] sm:text-[10px] tracking-widest text-muted-foreground mt-0.5">SECS</div>
                </div>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase">
                {isClosed ? "Betting closed" : "Accepting bets"}
              </p>
            </div>

            {/* Current price — spans both columns on mobile */}
            <div className="col-span-2 sm:col-span-1 space-y-0.5 sm:text-center">
              <div className="flex items-center gap-1.5 sm:justify-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-mono uppercase tracking-wider">
                  Current price
                </p>
                {openPrice && (
                  <span
                    className={`flex items-center gap-0.5 text-[10px] sm:text-xs font-mono font-bold ${
                      priceUp ? "text-green-400" : priceDown ? "text-red-400" : "text-muted-foreground"
                    }`}
                  >
                    {priceUp ? <TrendingUp className="h-3 w-3" /> : priceDown ? <TrendingDown className="h-3 w-3" /> : null}
                    ${formatUsd(priceChangeAbs)}
                  </span>
                )}
              </div>
              <p
                className="text-lg sm:text-2xl font-mono font-bold text-orange-400"
                data-testid="text-btc-price"
              >
                ${formatUsd(btcPriceUsd)}
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
                <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
                <span className="text-[10px] sm:text-xs font-mono text-orange-400">
                  Live: ${formatUsd(btcPriceUsd)}
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

      {/* My Last Bet widget */}
      {lastBetHash && (
        <MyBetWidget
          paymentHash={lastBetHash}
          onDismiss={() => {
            clearLastBetHash();
            setLastBetHash(null);
          }}
        />
      )}

      {betDirection && market.windowId && (
        <BetModal
          isOpen={true}
          onClose={() => {
            setBetDirection(null);
            setLastBetHash(getLastBetHash());
          }}
          direction={betDirection}
          btcPriceUsd={btcPriceUsd}
          windowId={market.windowId}
        />
      )}
    </div>
  );
}
