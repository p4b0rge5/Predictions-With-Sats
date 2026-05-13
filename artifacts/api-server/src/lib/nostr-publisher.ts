/**
 * Nostr Publisher
 *
 * Business-layer integration between PWSats events and Nostr posts.
 * Fire-and-forget: Nostr failures must NEVER block the core business flow.
 *
 * Phase 1: text-only posts with emojis (no card images).
 * Card images will be added in a future phase.
 */

import { publishNostrEvent } from "./nostr";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Feature toggle
// ---------------------------------------------------------------------------

function isEnabled(): boolean {
  return !!process.env.NOSTR_PRIVATE_KEY;
}

// ---------------------------------------------------------------------------
// Sport Market: New market created
// ---------------------------------------------------------------------------

export async function publishSportMarketCreated(market: {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  startsAt: Date | string;
  totalHomeSats?: number;
  totalDrawSats?: number;
  totalAwaySats?: number;
  homeBadge?: string | null;
  awayBadge?: string | null;
  leagueLogo?: string | null;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const d = typeof market.startsAt === "string" ? new Date(market.startsAt) : market.startsAt;
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

    const total = (market.totalHomeSats ?? 0) + (market.totalDrawSats ?? 0) + (market.totalAwaySats ?? 0);

    const hasDraw = !["American Football", "Baseball", "MMA", "Mixed Martial Arts"].includes(market.sport);

    // Each outcome on its own line, in order: HOME, DRAW, AWAY
    const outcomes = hasDraw
      ? `🟢 ${market.homeTeam}\n🟡 Draw\n🔵 ${market.awayTeam}`
      : `🟢 ${market.homeTeam}\n🔵 ${market.awayTeam}`;

    const betOptions = hasDraw ? "Home, Draw or Away" : "Home or Away";

    const text = `⚡ New market!\n\n${market.homeTeam} vs ${market.awayTeam}\n\n${outcomes}\n\n🏆 ${market.league}\n📅 ${dateStr} at ${timeStr} UTC${total > 0 ? `\n💰 Pool: ${total.toLocaleString()} sats` : ""}\n\nBet ${betOptions} with Bitcoin Lightning\n\npwsats.com`;

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", market.sport.toLowerCase().replace(/[\s/]+/g, "_")],
    ];

    await publishNostrEvent(text, tags, 1);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish sport market to Nostr");
  }
}

// ---------------------------------------------------------------------------
// Sport Market: Settled with result
// ---------------------------------------------------------------------------

export async function publishSportMarketSettled(market: {
  id: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  homeScore: number | null;
  awayScore: number | null;
  homeSats: number;
  drawSats: number;
  awaySats: number;
  startsAt: Date | string;
  homeBadge?: string | null;
  awayBadge?: string | null;
  leagueLogo?: string | null;
  outcome?: string | null;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const hs = market.homeScore ?? "?";
    const aw = market.awayScore ?? "?";
    const total = market.homeSats + market.drawSats + market.awaySats;

    let winner = "DRAW";
    let winnerEmoji = "🟡";
    if (market.outcome === "home") { winner = market.homeTeam; winnerEmoji = "🟢"; }
    else if (market.outcome === "away") { winner = market.awayTeam; winnerEmoji = "🔵"; }

    const hasDraw = !["American Football", "Baseball", "MMA", "Mixed Martial Arts"].includes(market.sport);

    const outcomes = hasDraw
      ? `🟢 ${market.homeTeam} ${hs}\n🟡 Draw\n🔵 ${market.awayTeam} ${aw}`
      : `🟢 ${market.homeTeam} ${hs}\n🔵 ${market.awayTeam} ${aw}`;

    const text = `🏆 RESULT\n\n${market.homeTeam} vs ${market.awayTeam}\n\n${outcomes}\n\n${winnerEmoji} ${winner} wins!\n💰 Pool: ${total.toLocaleString()} sats\n\n🏆 ${market.league}\nMore markets → pwsats.com`;

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "result"],
      ["t", market.sport.toLowerCase().replace(/[\s/]+/g, "_")],
    ];

    await publishNostrEvent(text, tags, 1);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish sport market settlement to Nostr");
  }
}

// ---------------------------------------------------------------------------
// Weather Market: New market
// ---------------------------------------------------------------------------

export async function publishWeatherMarketCreated(market: {
  id: number;
  city: string;
  question: string;
  threshold: string | number;
  date?: string;
  yesSats?: number;
  noSats?: number;
  outcomes?: Array<{ key: string; label: string; price: number | null; poolSats: number }>;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const total = (market.yesSats ?? 0) + (market.noSats ?? 0);

    // Build outcomes display: if we have real outcomes (multi-option), show them.
    // Otherwise fall back to legacy YES/NO.
    let outcomesText: string;
    let betOptions = "YES or NO";
    const emojis = ["🔵", "🟢", "🟡", "🟠", "🔴", "🟣", "⚪", "⚫"];

    if (market.outcomes && market.outcomes.length > 0) {
      outcomesText = market.outcomes
        .map((o, i) => `${emojis[i % emojis.length]} ${o.label}`)
        .join("\n");
      betOptions = `Pick the temperature`;
    } else {
      const thresh = typeof market.threshold === "number" ? `${market.threshold}°C` : market.threshold;
      outcomesText = "🟢 YES\n🔴 NO";
      betOptions = `YES or NO\n🌡️ Threshold: ${thresh}`;
    }

    const text = `⚡ New weather market!\n\n📍 ${market.city}\n\n${market.question}\n\n${outcomesText}${total > 0 ? `\n💰 Pool: ${total.toLocaleString()} sats` : ""}\n\nBet ${betOptions} with Bitcoin Lightning\n\npwsats.com`;

    const tags = [["t", "pwsats"], ["t", "bitcoin"], ["t", "lightning"], ["t", "weather"]];
    await publishNostrEvent(text, tags, 1);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish weather market to Nostr");
  }
}

// ---------------------------------------------------------------------------
// Weather Market: Settled
// ---------------------------------------------------------------------------

export async function publishWeatherMarketSettled(market: {
  id: number;
  city: string;
  question: string;
  threshold: string | number;
  resolvedValue: string | null;
  yesSats: number;
  noSats: number;
  outcome?: string | null;
  outcomes?: Array<{ key: string; label: string; price: number | null; poolSats: number; isWinner?: boolean | null }>;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const total = market.yesSats + market.noSats;
    const thresh = typeof market.threshold === "number" ? `${market.threshold}°C` : market.threshold;

    let outcomesText: string;
    let winnerLine: string;

    if (market.outcomes && market.outcomes.length > 0) {
      const emojis = ["🔵", "🟢", "🟡", "🟠", "🔴", "🟣", "⚪", "⚫"];
      outcomesText = market.outcomes
        .map((o, i) => {
          const marker = o.isWinner ? "✅" : "  ";
          return `${marker} ${emojis[i % emojis.length]} ${o.label}`;
        })
        .join("\n");

      const winner = market.outcomes.find((o) => o.isWinner);
      winnerLine = winner ? `✅ ${winner.label} wins!` : `🌡️ Actual: ${market.resolvedValue ?? "N/A"}`;
    } else {
      const winner = market.outcome === "yes" ? "YES" : market.outcome === "no" ? "NO" : "NO";
      const winnerEmoji = market.outcome === "yes" ? "🟢" : "🔴";
      outcomesText = `🟢 YES ${market.yesSats.toLocaleString()} sats\n🔴 NO ${market.noSats.toLocaleString()} sats`;
      winnerLine = `${winnerEmoji} ${winner} wins!`;
    }

    const text = `🌤️ RESULT\n\n📍 ${market.city}\n\n${market.question}\n\n${outcomesText}\n\n${winnerLine}\n🌡️ Actual: ${market.resolvedValue ?? "N/A"} · Threshold: ${thresh}°C\n💰 Pool: ${total.toLocaleString()} sats\n\nMore markets → pwsats.com`;

    const tags = [["t", "pwsats"], ["t", "bitcoin"], ["t", "weather"], ["t", "result"]];
    await publishNostrEvent(text, tags, 1);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish weather market settlement to Nostr");
  }
}
