/**
 * Text-Only Nostr Digest Generator
 *
 * Queries open sport markets from the DB and produces a formatted text
 * post (no image) showing all active events with team badges (emoji),
 * league, date/time, and pool totals. Designed for organic Nostr feeds.
 */

// Import only schema + db — avoid @workspace/db which also pulls in the seed module
// (seed has a TDZ circular dep bug in ESM mode)
import { db } from "@workspace/db/db";
import { sportMarketsTable } from "@workspace/db/schema/sport-markets";
import { eq, desc, and, gte, or } from "drizzle-orm";
import { logger } from "./logger";
import { publishNostrEvent } from "./nostr";

// ---------------------------------------------------------------------------
// Sport emoji map
// ---------------------------------------------------------------------------

const SPORT_EMOJI: Record<string, string> = {
  Soccer: "⚽",
  Football: "🏈",
  "American Football": "🏈",
  Basketball: "🏀",
  Baseball: "⚾",
  Hockey: "🏒",
  MMA: "🥊",
  "Mixed Martial Arts": "🥊",
  Rugby: "🏉",
  Tennis: "🎾",
  Cricket: "🏏",
};

function sportEmoji(sport: string): string {
  return SPORT_EMOJI[sport] || "🏟️";
}

// Sports where DRAW is not a valid outcome
const NO_DRAW_SPORTS = new Set([
  "American Football", "Baseball", "MMA", "Mixed Martial Arts", "Hockey",
]);

// ---------------------------------------------------------------------------
// Format a UTC timestamp for display (avoids "24:xx" nonsense)
// ---------------------------------------------------------------------------

function formatUTC(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getUTCDate();
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} · ${hours}:${minutes} UTC`;
}

// ---------------------------------------------------------------------------
// Format a single market as a text block
// ---------------------------------------------------------------------------

function formatMarket(market: {
  homeTeam: string; awayTeam: string; league: string; sport: string;
  startsAt: Date;
  totalHomeSats: number; totalDrawSats: number; totalAwaySats: number;
  homeScore?: number | null; awayScore?: number | null;
  outcome?: string | null; status?: string;
}): string {
  const em = sportEmoji(market.sport);
  const hasDraw = !NO_DRAW_SPORTS.has(market.sport);

  const isSettled = market.outcome != null
    && market.outcome !== "no_liquidity"
    && market.outcome !== "no_bets";
  const isRefund = market.outcome === "no_liquidity" || market.outcome === "no_bets";

  const total = market.totalHomeSats + market.totalDrawSats + market.totalAwaySats;
  const totalStr = total > 0 ? `${total.toLocaleString()} sats` : "no bets yet";

  const lines = [
    `${em} ${market.league}`,
    `◉ ${market.homeTeam}`,
    `  vs`,
    `◉ ${market.awayTeam}`,
    `📅 ${formatUTC(market.startsAt)}`,
  ];

  if (isSettled) {
    const hs = market.homeScore ?? "?";
    const aw = market.awayScore ?? "?";
    let winner = "DRAW";
    if (market.outcome === "home") winner = market.homeTeam;
    else if (market.outcome === "away") winner = market.awayTeam;
    lines.push(``);
    lines.push(`🏆 ${hs} — ${aw} → ${winner}`);
    lines.push(`Pool: ${totalStr}`);
  } else if (isRefund) {
    lines.push(``);
    lines.push(`⚠️ No valid bets — refunds only`);
    if (total > 0) lines.push(`Pool: ${totalStr}`);
  } else {
    // Open market
    lines.push(``);
    if (hasDraw) {
      lines.push(
        `↑ ${market.totalHomeSats.toLocaleString()} ` +
        `· = ${market.totalDrawSats.toLocaleString()} ` +
        `· ↓ ${market.totalAwaySats.toLocaleString()}`
      );
    } else {
      lines.push(
        `↑ ${market.totalHomeSats.toLocaleString()} ` +
        `· ↓ ${market.totalAwaySats.toLocaleString()}`
      );
    }
    lines.push(`Total: ${totalStr}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generate the full digest text
// ---------------------------------------------------------------------------

export function generateMarketDigestText(markets: Array<{
  homeTeam: string; awayTeam: string; league: string; sport: string;
  startsAt: Date;
  totalHomeSats: number; totalDrawSats: number; totalAwaySats: number;
  homeScore?: number | null; awayScore?: number | null;
  outcome?: string | null; status?: string;
}>): string {
  if (markets.length === 0) {
    return `⚡ PWSats — Active Markets\n\nNo open markets right now. Check back soon!\n\n⚡ Bet with Lightning · pwsats.com`;
  }

  const openCount = markets.filter(m => m.status === "open" && m.outcome == null).length;
  const settledCount = markets.length - openCount;

  const totalPool = markets.reduce(
    (sum, m) => sum + m.totalHomeSats + m.totalDrawSats + m.totalAwaySats, 0
  );

  const header = openCount > 0 && settledCount > 0
    ? `⚡ PWSats — ${openCount} Open · ${settledCount} Settled`
    : openCount > 0
      ? `⚡ PWSats — ${openCount} Open Market${openCount > 1 ? "s" : ""}`
      : `⚡ PWSats — ${settledCount} Recent Result${settledCount > 1 ? "s" : ""}`;

  const lines = [
    header,
    `Total pool: ${totalPool.toLocaleString()} sats`,
    "",
    "━".repeat(40),
    "",
  ];

  for (const m of markets) {
    lines.push(formatMarket(m));
    lines.push("");
    lines.push("━".repeat(40));
    lines.push("");
  }

  lines.push("Bet with Bitcoin Lightning · No account needed");
  lines.push("Winners split the pool (2% fee)");
  lines.push("");
  lines.push("⚡ pwsats.com");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Publish digest to Nostr (text only, no image)
// ---------------------------------------------------------------------------

export function isEnabled(): boolean {
  return !!process.env.NOSTR_PRIVATE_KEY;
}

export async function publishMarketDigest(): Promise<{
  success: boolean;
  text: string;
  marketCount: number;
  eventId?: string;
  okCount?: number;
  failCount?: number;
}> {
  // Fetch open markets ordered by start time ASC (soonest first)
  const openMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.status, "open"))
    .orderBy(desc(sportMarketsTable.startsAt));

  // Also include recently settled (last 48h)
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentSettled = await db
    .select()
    .from(sportMarketsTable)
    .where(
      and(
        eq(sportMarketsTable.status, "settled"),
        gte(sportMarketsTable.settledAt, fortyEightHoursAgo),
      )
    )
    .orderBy(desc(sportMarketsTable.settledAt))
    .limit(5);

  const allMarkets = [
    ...openMarkets,
    ...recentSettled,
  ];

  const text = generateMarketDigestText(allMarkets);

  type Result = {
    success: boolean;
    text: string;
    marketCount: number;
    eventId?: string;
    okCount?: number;
    failCount?: number;
  };

  const result: Result = { success: false, text, marketCount: allMarkets.length };

  if (!isEnabled()) {
    logger.info("Nostr not enabled — returning digest text only");
    return result;
  }

  try {
    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", "predictions"],
    ];

    const res = await publishNostrEvent(text, tags, 1);
    result.success = res.okCount > 0;
    result.eventId = res.eventId;
    result.okCount = res.okCount;
    result.failCount = res.failCount;

    logger.info(
      { marketCount: allMarkets.length, okCount: res.okCount },
      "Market digest published to Nostr",
    );
  } catch (err) {
    logger.warn({ err }, "Failed to publish market digest to Nostr");
  }

  return result;
}
