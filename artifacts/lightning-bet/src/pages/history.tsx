import { useGetMarketHistory, getGetMarketHistoryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export function History() {
  const { data: history, isLoading } = useGetMarketHistory({ limit: 50 }, { query: { refetchInterval: 15000, queryKey: getGetMarketHistoryQueryKey({ limit: 50 }) } });

  const formatSats = (sats: number) => new Intl.NumberFormat().format(sats);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-mono font-bold tracking-tight">Window History</h1>
      </div>

      <Card>
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
              {!history?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono">
                    No history available
                  </TableCell>
                </TableRow>
              ) : (
                history.map((window) => {
                  const totalSats = window.totalUpSats + window.totalDownSats;
                  const isUp = window.outcome === "up";
                  const isDown = window.outcome === "down";
                  
                  return (
                    <TableRow key={window.id} className="font-mono text-sm" data-testid={`row-history-${window.id}`}>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(window.openedAt), "MMM d, HH:mm")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {isUp ? (
                            <span className="flex items-center text-green-500 font-bold bg-green-500/10 px-2 py-0.5 rounded">
                              <ArrowUpRight className="h-4 w-4 mr-1" /> UP
                            </span>
                          ) : isDown ? (
                            <span className="flex items-center text-red-500 font-bold bg-red-500/10 px-2 py-0.5 rounded">
                              <ArrowDownRight className="h-4 w-4 mr-1" /> DOWN
                            </span>
                          ) : window.outcome === "draw" ? (
                            <span className="flex items-center text-yellow-500 font-bold bg-yellow-500/10 px-2 py-0.5 rounded">
                              <Minus className="h-4 w-4 mr-1" /> DRAW
                            </span>
                          ) : (
                            <span className="text-muted-foreground">PENDING</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        ${window.openPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        ${window.closePrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "-"}
                      </TableCell>
                      <TableCell className={`text-right ${isUp ? 'text-green-500' : isDown ? 'text-red-500' : ''}`}>
                        {window.priceChangePercent ? `${window.priceChangePercent > 0 ? '+' : ''}${window.priceChangePercent.toFixed(3)}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatSats(totalSats)} sats
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
