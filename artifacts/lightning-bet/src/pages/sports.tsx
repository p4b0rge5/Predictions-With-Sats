import { useState, useEffect } from "react";
import { Trophy, Clock, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SportEvent {
  id: string;
  event: string;
  homeTeam: string;
  awayTeam: string;
  homeBadge: string | null;
  awayBadge: string | null;
  league: string;
  sport: string;
  startsAt: string;
  status: "upcoming" | "finished" | "live";
  homeScore: number | null;
  awayScore: number | null;
  outcome: "home" | "away" | "draw" | null;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getApiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function TeamBadge({ src, name }: { src: string | null; name: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
        {name.slice(0, 2).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="w-8 h-8 object-contain"
      onError={() => setError(true)}
    />
  );
}

function OutcomeBadge({ outcome }: { outcome: SportEvent["outcome"] }) {
  if (!outcome) return null;
  if (outcome === "home")
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">HOME WIN</Badge>;
  if (outcome === "away")
    return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">AWAY WIN</Badge>;
  return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">DRAW</Badge>;
}

function formatKickoff(isoStr: string) {
  const d = new Date(isoStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function UpcomingCard({ ev }: { ev: SportEvent }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {ev.league}
        </span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
          <Clock className="h-3 w-3" />
          {formatKickoff(ev.startsAt)}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.homeTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">HOME</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold font-mono text-muted-foreground">VS</span>
        </div>

        <div className="flex-1 flex flex-col items-center gap-1.5">
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
          <span className="text-xs font-semibold text-center leading-tight">{ev.awayTeam}</span>
          <span className="text-[9px] text-muted-foreground font-mono">AWAY</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          size="sm"
          className="h-10 text-xs font-mono font-bold bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 hover:border-green-500/60 transition-all"
        >
          ↑ HOME WINS
        </Button>
        <Button
          size="sm"
          className="h-10 text-xs font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 hover:border-blue-500/60 transition-all"
        >
          ↓ AWAY WINS
        </Button>
      </div>

      <p className="text-[9px] text-muted-foreground text-center">
        DRAW → refund at 98% · settled automatically at final whistle
      </p>
    </div>
  );
}

function FinishedCard({ ev }: { ev: SportEvent }) {
  const settlement =
    ev.outcome === "home"
      ? "HOME WINS bettors collect the pool"
      : ev.outcome === "away"
      ? "AWAY WINS bettors collect the pool"
      : "DRAW — all bettors refunded at 98%";

  return (
    <div className="rounded-xl border border-border/40 bg-card/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider truncate">
          {ev.league}
        </span>
        <OutcomeBadge outcome={ev.outcome} />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <TeamBadge src={ev.homeBadge} name={ev.homeTeam} />
          <span className="text-xs font-semibold truncate">{ev.homeTeam}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono font-bold text-sm shrink-0">
          <span className={ev.outcome === "home" ? "text-green-400" : "text-foreground"}>
            {ev.homeScore}
          </span>
          <span className="text-muted-foreground">–</span>
          <span className={ev.outcome === "away" ? "text-blue-400" : "text-foreground"}>
            {ev.awayScore}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
          <span className="text-xs font-semibold truncate text-right">{ev.awayTeam}</span>
          <TeamBadge src={ev.awayBadge} name={ev.awayTeam} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
        <span>{settlement}</span>
      </div>
    </div>
  );
}

export function Sports() {
  const [data, setData] = useState<{ upcoming: SportEvent[]; finished: SportEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");

  const fetchData = () => {
    setLoading(true);
    setError(false);
    fetch(getApiUrl("/api/sports/events"))
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-400" />
            <h1 className="text-xl font-bold font-mono tracking-tight">Sports Predictions</h1>
            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px] font-mono">
              PROTOTYPE
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Predict match outcomes — HOME WINS or AWAY WINS. Powered by TheSportsDB.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          className="text-muted-foreground shrink-0"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5 text-[11px] text-yellow-400/80 font-mono space-y-0.5">
        <p className="font-bold text-yellow-400">⚡ How it would work</p>
        <p>Bet HOME WINS or AWAY WINS using sats via Lightning. Pool settles automatically when the final score is available. DRAW → 98% refund. Min bet $0.50.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/30 border border-border/40">
        {(["upcoming", "results"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "upcoming" ? "Upcoming Matches" : "Recent Results"}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center h-40 gap-3 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Fetching matches…</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="font-mono text-sm">Failed to load events. Try refreshing.</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {tab === "upcoming" && (
            <div className="space-y-3">
              {data.upcoming.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-10 font-mono">No upcoming matches found.</p>
              )}
              {data.upcoming.map((ev) => (
                <UpcomingCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}

          {tab === "results" && (
            <div className="space-y-2">
              {data.finished.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-10 font-mono">No recent results found.</p>
              )}
              {data.finished.map((ev) => (
                <FinishedCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
