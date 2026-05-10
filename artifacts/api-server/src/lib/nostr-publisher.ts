/**
 * Nostr Publisher
 *
 * Business-layer integration between PWSats events and Nostr posts.
 * Fire-and-forget: Nostr failures must NEVER block the core business flow.
 */

import { publishNostrPostWithImage } from "./nostr";
import { generateSportMarketCard, generateWeatherMarketCard } from "./card-image";
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
  homeBadge?: string | null;
  awayBadge?: string | null;
  leagueLogo?: string | null;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const d = typeof market.startsAt === "string" ? new Date(market.startsAt) : market.startsAt;
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

    const text = `⚡ New market! ${market.homeTeam} vs ${market.awayTeam}\n\n🏆 ${market.league}\n📅 ${dateStr} at ${timeStr} UTC\n\nBet Home, Draw or Away with Bitcoin Lightning\n\npwsats.com`;

    const imageBase64 = await generateSportMarketCard({
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      league: market.league,
      sport: market.sport,
      startsAt: market.startsAt,
      homeSats: 0,
      drawSats: 0,
      awaySats: 0,
      homeBadge: market.homeBadge ?? undefined,
      awayBadge: market.awayBadge ?? undefined,
      leagueLogo: market.leagueLogo ?? undefined,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", market.sport.toLowerCase().replace(/[\s/]+/g, "_")],
    ];

    await publishNostrPostWithImage(text, imageBase64, tags);
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
    if (market.outcome === "home") winner = market.homeTeam;
    else if (market.outcome === "away") winner = market.awayTeam;

    const text = `🏆 RESULT: ${market.homeTeam} ${hs} — ${aw} ${market.awayTeam}\n\n${winner} wins! Pool: ${total.toLocaleString()} sats\n\n🏆 ${market.league}\nMore markets → pwsats.com`;

    const imageBase64 = await generateSportMarketCard({
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      league: market.league,
      sport: market.sport,
      startsAt: market.startsAt,
      homeSats: market.homeSats,
      drawSats: market.drawSats,
      awaySats: market.awaySats,
      status: "settled",
      homeScore: market.homeScore,
      awayScore: market.awayScore,
      outcome: market.outcome,
      homeBadge: market.homeBadge ?? undefined,
      awayBadge: market.awayBadge ?? undefined,
      leagueLogo: market.leagueLogo ?? undefined,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "result"],
      ["t", market.sport.toLowerCase().replace(/[\s/]+/g, "_")],
    ];

    await publishNostrPostWithImage(text, imageBase64, tags);
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
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const text = `🌤️ New weather market!\n\n${market.question}\n\nThreshold: ${typeof market.threshold === "number" ? `${market.threshold}°C` : market.threshold}\n\nBet YES or NO with Lightning ⚡\npwsats.com`;

    const imageBase64 = await generateWeatherMarketCard({
      city: market.city,
      question: market.question,
      threshold: market.threshold,
      yesSats: 0,
      noSats: 0,
    });

    const tags = [["t", "pwsats"], ["t", "bitcoin"], ["t", "lightning"], ["t", "weather"]];
    await publishNostrPostWithImage(text, imageBase64, tags);
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
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const total = market.yesSats + market.noSats;

    const text = `🌤️ Weather result!\n\n${market.question}\n\nActual: ${market.resolvedValue ?? "N/A"} · Pool: ${total.toLocaleString()} sats\n\n${market.city}\nMore markets → pwsats.com`;

    const imageBase64 = await generateWeatherMarketCard({
      city: market.city,
      question: market.question,
      threshold: market.threshold,
      yesSats: market.yesSats,
      noSats: market.noSats,
      status: "settled",
      resolvedValue: market.resolvedValue,
    });

    const tags = [["t", "pwsats"], ["t", "bitcoin"], ["t", "weather"], ["t", "result"]];
    await publishNostrPostWithImage(text, imageBase64, tags);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish weather market settlement to Nostr");
  }
}
