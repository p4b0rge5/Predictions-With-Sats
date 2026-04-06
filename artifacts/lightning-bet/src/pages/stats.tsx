import { useGetPlatformStats, getGetPlatformStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Hash, Zap, TrendingUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  description: string;
  tooltip: string;
}

function StatCard({ icon, label, value, description, tooltip }: StatCardProps) {
  return (
    <Card className="bg-card/50 backdrop-blur border-2">
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-muted-foreground text-sm uppercase tracking-wider flex items-center gap-2">
          {icon}
          {label}
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="ml-auto text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-60 text-xs font-mono">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <div>{value}</div>
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

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
        <StatCard
          icon={<Zap className="h-4 w-4" />}
          label="Total Volume"
          value={
            <div className="text-5xl font-mono font-bold tracking-tighter text-yellow-400">
              {formatSats(stats.totalVolumeSats)}{" "}
              <span className="text-2xl text-muted-foreground">sats</span>
            </div>
          }
          description="Sum of all satoshis wagered across every bet ever placed on the platform — paid and refunded bets included."
          tooltip="Calculated as the sum of amountSats for all non-expired bets. Includes wins, losses, draws, and no-liquidity refunds."
        />

        <StatCard
          icon={<Hash className="h-4 w-4" />}
          label="Total Bets Placed"
          value={
            <div className="text-5xl font-mono font-bold tracking-tighter">
              {new Intl.NumberFormat().format(stats.totalBets)}
            </div>
          }
          description="Number of individual bet invoices that were paid. Each bet is a single Lightning payment for one direction (UP or DOWN) in one window."
          tooltip="Counts all bets with status != 'pending' and != 'expired'. One user can place multiple bets across different windows."
        />

        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Windows Settled"
          value={
            <div className="text-5xl font-mono font-bold tracking-tighter">
              {new Intl.NumberFormat().format(stats.totalWindowsSettled)}
            </div>
          }
          description="Number of 5-minute price windows that have been fully settled. Each window = 5 minutes of real time (e.g., 100 windows ≈ 8 hours of operation)."
          tooltip="Counts market windows with status = 'settled'. Settlement happens ~20 seconds after the window closes to allow the final BTC price to be fetched."
        />

        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Bull Win Rate"
          value={
            <div className="text-5xl font-mono font-bold tracking-tighter text-green-500">
              {(stats.upWinRate * 100).toFixed(1)}%
            </div>
          }
          description="Percentage of settled windows where BTC closed higher than it opened (UP outcome). Approaching 50% is expected over the long run."
          tooltip="Calculated as: (windows with outcome = 'up') ÷ (total settled windows). Draws and no-liquidity windows count toward the denominator."
        />
      </div>

      <p className="text-[11px] font-mono text-muted-foreground/50 text-center pt-2">
        Stats refresh every 60 seconds. All values are all-time since platform launch.
      </p>
    </div>
  );
}
