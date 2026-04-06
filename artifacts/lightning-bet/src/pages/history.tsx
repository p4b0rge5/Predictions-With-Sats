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

  const OutcomeBadge = ({ outcome }: { outcome?: string }) => {
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
                  {/* Top row: time + outcome */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(w.openedAt), "MMM d, HH:mm")}
                    </span>
                    <OutcomeBadge outcome={w.outcome} />
                  </div>

                  {/* Prices row */}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">Open</span>
                    <span className="font-bold">${w.openPrice ? formatUsd(w.openPrice) : "—"}</span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="text-xs text-muted-foreground">Close</span>
                    <span className="font-bold">${w.closePrice ? formatUsd(w.closePrice) : "—"}</span>
                    {w.priceChangePercent && (
                      <span className={`ml-auto text-xs font-bold ${changeColor}`}>
                        {w.priceChangePercent > 0 ? "+" : ""}
                        {w.priceChangePercent.toFixed(3)}%
                      </span>
                    )}
                  </div>

                  {/* Pool */}
                  {totalSats > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      Pool: {formatSats(totalSats)} sats
                    </div>
                  )}
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
                    <TableHead>Time</TableHead>
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
                          {format(new Date(w.openedAt), "MMM d, HH:mm")}
                        </TableCell>
                        <TableCell>
                          <OutcomeBadge outcome={w.outcome} />
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
