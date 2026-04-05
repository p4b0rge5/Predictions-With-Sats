import { useGetPlatformStats, getGetPlatformStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Hash, Zap, TrendingUp } from "lucide-react";

export function Stats() {
  const { data: stats, isLoading } = useGetPlatformStats({ query: { refetchInterval: 60000, queryKey: getGetPlatformStatsQueryKey() } });

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const formatSats = (sats: number) => new Intl.NumberFormat().format(sats);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-mono font-bold tracking-tight">Platform Stats</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card/50 backdrop-blur border-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
              <Zap className="h-4 w-4" /> Total Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-mono font-bold tracking-tighter text-yellow-400">
              {formatSats(stats.totalVolumeSats)} <span className="text-2xl text-muted-foreground">sats</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
              <Hash className="h-4 w-4" /> Total Bets Placed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-mono font-bold tracking-tighter">
              {new Intl.NumberFormat().format(stats.totalBets)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4" /> Windows Settled
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-mono font-bold tracking-tighter">
              {new Intl.NumberFormat().format(stats.totalWindowsSettled)}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-2">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Bull Win Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-mono font-bold tracking-tighter text-green-500">
              {(stats.upWinRate * 100).toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
