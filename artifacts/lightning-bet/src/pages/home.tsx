import { useGetCurrentMarket, getGetCurrentMarketQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpCircle, ArrowDownCircle, AlertCircle, Clock } from "lucide-react";
import { BetModal } from "@/components/bet-modal";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";

export function Home() {
  const { data: market, isLoading } = useGetCurrentMarket({ query: { refetchInterval: 10000, queryKey: getGetCurrentMarketQueryKey() } });
  const [betDirection, setBetDirection] = useState<"up" | "down" | null>(null);

  if (isLoading || !market) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="font-mono text-muted-foreground">LOADING MARKET DATA...</p>
        </div>
      </div>
    );
  }

  const {
    status,
    btcPriceUsd,
    openPrice,
    secondsRemaining,
    totalUpSats,
    totalDownSats
  } = market;

  const isClosed = status === "closed" || secondsRemaining < 30;
  const isNone = status === "none";
  
  const totalSats = totalUpSats + totalDownSats;
  const upPercent = totalSats > 0 ? (totalUpSats / totalSats) * 100 : 50;
  
  const priceChange = openPrice ? ((btcPriceUsd - openPrice) / openPrice) * 100 : 0;
  const isUp = priceChange > 0;
  const isDown = priceChange < 0;

  const formatSats = (sats: number) => new Intl.NumberFormat().format(sats);
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {isNone ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold font-mono">NO ACTIVE WINDOW</h2>
            <p className="text-muted-foreground mt-2">Waiting for the next betting window to open.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-2 shadow-xl bg-card/50 backdrop-blur">
              <CardHeader className="pb-2">
                <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex justify-between items-center">
                  <span>Current BTC Price</span>
                  <span className={`text-xs px-2 py-1 rounded bg-muted ${isUp ? 'text-green-500' : isDown ? 'text-red-500' : ''}`}>
                    {openPrice ? `${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%` : 'LIVE'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-5xl font-mono font-bold tracking-tighter" data-testid="text-btc-price">
                  ${btcPriceUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                {openPrice && (
                  <div className="mt-2 text-sm text-muted-foreground font-mono">
                    Opened at ${openPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={`border-2 shadow-xl ${secondsRemaining < 30 ? 'border-red-500/50 bg-red-500/5' : 'bg-card/50 backdrop-blur'}`}>
              <CardHeader className="pb-2">
                <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Time Remaining
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div 
                  className={`text-5xl font-mono font-bold tracking-tighter ${secondsRemaining < 30 ? 'text-red-500 animate-pulse' : ''}`}
                  data-testid="text-countdown"
                >
                  {formatTime(Math.max(0, secondsRemaining))}
                </div>
                <div className="mt-2 text-sm text-muted-foreground font-mono uppercase">
                  {isClosed ? "Betting Closed - Resolving" : "Accepting Bets"}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <Button 
                onClick={() => setBetDirection("up")} 
                disabled={isClosed}
                className="w-full h-32 text-2xl font-mono font-bold bg-green-500/10 text-green-500 border-2 border-green-500/50 hover:bg-green-500/20 hover:border-green-500 transition-all flex flex-col gap-2"
                data-testid="button-bet-up"
              >
                <div className="flex items-center gap-2">
                  <ArrowUpCircle className="h-8 w-8" />
                  BET UP
                </div>
                <span className="text-sm font-normal opacity-80">
                  {formatSats(totalUpSats)} sats in pool
                </span>
              </Button>
            </div>

            <div className="space-y-4">
              <Button 
                onClick={() => setBetDirection("down")} 
                disabled={isClosed}
                className="w-full h-32 text-2xl font-mono font-bold bg-red-500/10 text-red-500 border-2 border-red-500/50 hover:bg-red-500/20 hover:border-red-500 transition-all flex flex-col gap-2"
                data-testid="button-bet-down"
              >
                <div className="flex items-center gap-2">
                  <ArrowDownCircle className="h-8 w-8" />
                  BET DOWN
                </div>
                <span className="text-sm font-normal opacity-80">
                  {formatSats(totalDownSats)} sats in pool
                </span>
              </Button>
            </div>
          </div>

          <Card className="bg-card/30">
            <CardContent className="pt-6">
              <div className="flex justify-between font-mono text-sm mb-2">
                <span className="text-green-500">{upPercent.toFixed(1)}% UP</span>
                <span className="text-muted-foreground">Total Pool: {formatSats(totalSats)} sats</span>
                <span className="text-red-500">{(100 - upPercent).toFixed(1)}% DOWN</span>
              </div>
              <div className="h-4 w-full bg-red-500/20 rounded overflow-hidden flex">
                <div 
                  className="h-full bg-green-500 transition-all duration-500" 
                  style={{ width: `${upPercent}%` }} 
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {betDirection && market.windowId && (
        <BetModal 
          isOpen={true} 
          onClose={() => setBetDirection(null)} 
          direction={betDirection}
          btcPriceUsd={btcPriceUsd}
          windowId={market.windowId}
        />
      )}
    </div>
  );
}
