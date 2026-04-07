import { useGetMarketHistory, getGetMarketHistoryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export function History() {
  const { data: history, isLoading } = useGetMarketHistory(
    { limit: 50 },
    { query: { refetchInterval: 15000, queryKey: getGetMarketHistoryQueryKey({ limit: 50 }) } }
  );

  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatSats = (sats: number) => new Intl.NumberFormat().format(sats);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

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

  const OutcomeBadge = ({ outcome, priceChangePercent }: { outcome?: string; priceChangePercent?: number | null }) => {
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

  const emptyState = !history?.length;

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
      <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight">Window History</h1>

      {emptyState ? (
        <Card>
          <CardContent className="h-32 flex items-center justify-center text-muted-foreground font-mono text-sm">
            No history available
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Mobile: stacked cards (< md) ── */}
          <div className="md:hidden space-y-2">
            {history!.map((w) => {
              const totalSats = w.totalUpSats + w.totalDownSats;
              const isUp = w.outcome === "up";
              const isDown = w.outcome === "down";
              const changeColor = isUp ? "text-green-500" : isDown ? "text-red-500" : "text-muted-foreground";

              return (
                <div
                  key={w.id}
                  className="rounded-xl border border-border/40 bg-card/40 px-4 py-3 font-mono flex flex-col gap-2"
                  data-testid={`row-history-${w.id}`}
                >
                  {/* Row 1: date + outcome badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(w.openedAt), "MMM d, HH:mm")}–{format(new Date(new Date(w.openedAt).getTime() + 5 * 60 * 1000), "HH:mm")}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono">Window #{w.id}</span>
                    </div>
                    <OutcomeBadge outcome={w.outcome} priceChangePercent={w.priceChangePercent} />
                  </div>

                  {/* Row 2: open → close (two stacked mini-labels, arrow centre) */}
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</p>
                      <p className="text-sm font-bold leading-tight">${w.openPrice ? formatUsd(w.openPrice) : "—"}</p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-lg leading-none">→</span>
                    <div className="min-w-0 flex-1 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Close</p>
                      <p className="text-sm font-bold leading-tight">${w.closePrice ? formatUsd(w.closePrice) : "—"}</p>
                    </div>
                  </div>

                  {/* Row 3: change % + pool (never overflows — both shrink-0 on own line) */}
                  <div className="flex items-center justify-between text-xs">
                    {w.priceChangePercent != null ? (
                      <span className={`font-bold ${changeColor}`}>
                        {w.priceChangePercent > 0 ? "+" : ""}
                        {w.priceChangePercent.toFixed(3)}%
                      </span>
                    ) : <span />}
                    {totalSats > 0 && (
                      <span className="text-muted-foreground">
                        Pool: {formatSats(totalSats)} sats
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop: table (>= md) ── */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="font-mono text-xs uppercase hover:bg-transparent">
                    <TableHead>Window</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Close</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Total Pool</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history!.map((w) => {
                    const totalSats = w.totalUpSats + w.totalDownSats;
                    const isUp = w.outcome === "up";
                    const isDown = w.outcome === "down";

                    return (
                      <TableRow key={w.id} className="font-mono text-sm" data-testid={`row-history-${w.id}`}>
                        <TableCell className="text-muted-foreground">
                          <div className="flex flex-col">
                            <span>{format(new Date(w.openedAt), "MMM d, HH:mm")}–{format(new Date(new Date(w.openedAt).getTime() + 5 * 60 * 1000), "HH:mm")}</span>
                            <span className="text-[10px] opacity-50">#{w.id}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <OutcomeBadge outcome={w.outcome} priceChangePercent={w.priceChangePercent} />
                        </TableCell>
                        <TableCell className="text-right">
                          ${w.openPrice ? formatUsd(w.openPrice) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          ${w.closePrice ? formatUsd(w.closePrice) : "—"}
                        </TableCell>
                        <TableCell className={`text-right ${isUp ? "text-green-500" : isDown ? "text-red-500" : ""}`}>
                          {w.priceChangePercent
                            ? `${w.priceChangePercent > 0 ? "+" : ""}${w.priceChangePercent.toFixed(3)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatSats(totalSats)} sats
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
