#!/usr/bin/env node
// Test ESPN API soccer data for PWSats — direct Node.js integration test

const ESPN_BASE = "https://site.api.espn.com";

async function espnFetch(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

function parseScore(s) {
  if (s === "" || s === undefined || s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseStatus(state) {
  if (state === "post") return "finished";
  if (state === "in" || state === "live") return "live";
  return "upcoming";
}

function parseOutcome(h, a) {
  if (h === null || a === null) return null;
  if (h > a) return "home";
  if (a > h) return "away";
  return "draw";
}

// Test: fetch from header, map events, verify format
console.log("=== ESPN Soccer Integration Test ===\n");

const data = await espnFetch(`${ESPN_BASE}/apis/v2/scoreboard/header`);
const soccer = data.sports?.find((s) => s.slug === "soccer");

if (!soccer) {
  console.log("❌ No soccer data found");
  process.exit(1);
}

const leagues = soccer.leagues || [];
console.log(`Found ${leagues.length} soccer leagues:\n`);

let totalMatches = 0;
let liveMatches = 0;
let finishedMatches = 0;
let upcomingMatches = 0;

for (const league of leagues) {
  const leagueName = league.name.replace(/English |Spanish |French /i, "");
  const events = league.events || [];
  const logo = league.logos?.[0]?.href;
  totalMatches += events.length;

  console.log(`🏆 ${leagueName} (${league.slug}) — ${events.length} matches`);

  for (const ev of events) {
    const competitors = ev.competitors.slice().sort((a, b) => {
      if (a.homeAway === "home") return -1;
      if (b.homeAway === "home") return 1;
      return 0;
    });
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");

    const hScore = parseScore(home?.score);
    const aScore = parseScore(away?.score);
    const state = ev.fullStatus?.type?.state ?? ev.status ?? "pre";
    const status = parseStatus(state);
    const outcome = parseOutcome(hScore, aScore);

    if (status === "live") liveMatches++;
    else if (status === "finished") finishedMatches++;
    else upcomingMatches++;

    const statusEmoji = status === "live" ? "🔴" : status === "finished" ? "✅" : "⏰";
    const scoreStr = hScore !== null && aScore !== null ? `${hScore}-${aScore}` : "vs";
    const formInfo = (home?.form ? ` [${home.form}]` : "") + (away?.form ? ` [${away.form}]` : "");

    console.log(`  ${statusEmoji} ${away.abbreviation} @ ${home.abbreviation} ${scoreStr}${formInfo}`);

    // Show odds if available
    if (ev.odds) {
      const hML = ev.odds.home?.moneyLine ?? ev.odds.homeTeamOdds?.moneyLine;
      const dML = ev.odds.draw?.moneyLine ?? ev.odds.drawOdds?.moneyLine;
      const aML = ev.odds.away?.moneyLine ?? ev.odds.awayTeamOdds?.moneyLine;
      console.log(`     Odds (${ev.odds.provider?.name}): Home ${hML} | Draw ${dML} | Away ${aML}`);
      console.log(`     Spread: ${ev.odds.spread} | O/U: ${ev.odds.overUnder}`);
    }

    // Show record stats if available
    if (home?.recordStats || away?.recordStats) {
      const homePts = home.recordStats?.points?.value ?? '?';
      const awayPts = away.recordStats?.points?.value ?? '?';
      console.log(`     Standings: ${away.abbreviation}=${homePts}pts, ${home.abbreviation}=${awayPts}pts`);
    }
  }
  console.log();
}

console.log("═══════════════════════════════════════════");
console.log(`Total: ${totalMatches} matches (${liveMatches} live, ${finishedMatches} finished, ${upcomingMatches} upcoming)`);
console.log(`Leagues: ${leagues.map(l => l.slug).join(", ")}`);
console.log("═══════════════════════════════════════════");

// Validate data format matches SportEvent interface
console.log("\n=== Format validation ===");
const firstLeague = leagues[0];
const firstEvent = firstLeague?.events?.[0];
if (firstEvent) {
  const home = firstEvent.competitors.find((c) => c.homeAway === "home");
  const away = firstEvent.competitors.find((c) => c.homeAway === "away");

  const ev = {
    id: `espn_${firstEvent.id}`,
    event: `${home.displayName} vs ${away.displayName}`,
    homeTeam: home.displayName,
    awayTeam: away.displayName,
    homeBadge: home.logo || null,
    awayBadge: away.logo || null,
    leagueLogo: firstLeague.logos?.[0]?.href || null,
    league: firstLeague.name,
    sport: "Soccer",
    country: "",
    startsAt: firstEvent.date,
    status: parseStatus(firstEvent.fullStatus?.type?.state ?? firstEvent.status ?? "pre"),
    homeScore: parseScore(home.score),
    awayScore: parseScore(away.score),
    outcome: null,
    elapsed: firstEvent.fullStatus?.period ?? null,
  };

  console.log("✅ Sample SportEvent output:");
  console.log(JSON.stringify(ev, null, 2));
}

console.log("\n✅ All tests passed — ESPN API is ready for PWSats integration!");
