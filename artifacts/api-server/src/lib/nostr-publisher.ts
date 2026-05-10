/**
 * Nostr Publisher
 *
 * Business-layer integration between PWSats events and Nostr posts.
 * This is the main module imported by sports-market.ts, weather.ts, etc.
 *
 * Responsibilities:
 * - Compose the post text (different templates for new market vs settlement)
 * - Generate the card image
 * - Publish to Nostr with proper tags (hashtags via 't' tags)
 *
 * Design: fire-and-forget with logging. Nostr failures must NEVER block
 * the core business flow (market creation, settlement, etc.)
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
  startsAt: Date;
  homeBadge?: string | null;
  awayBadge?: string | null;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const formattedDate = market.startsAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const formattedTime = market.startsAt.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const text = `New market! ${market.homeTeam} vs ${market.awayTeam} — ${market.league}, ${formattedDate} at ${formattedTime} UTC. Bet Home, Draw, or Away with Bitcoin Lightning. ⚡\n\npwsats.com`;

    const imageBase64 = await generateSportMarketCard({
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      league: market.league,
      sport: market.sport,
      startsAt: market.startsAt.toISOString(),
      homeBadge: market.homeBadge ?? undefined,
      awayBadge: market.awayBadge ?? undefined,
      homeSats: 0,
      drawSats: 0,
      awaySats: 0,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", market.sport.toLowerCase().replace(" ", "_")],
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
  startsAt: Date;
  homeBadge?: string | null;
  awayBadge?: string | null;
  outcome?: string;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const homeStr = market.homeScore ?? "?";
    const awayStr = market.awayScore ?? "?";
    const totalSats = market.homeSats + market.drawSats + market.awaySats;

    let winner = "DRAW";
    if (market.outcome === "home") winner = market.homeTeam;
    else if (market.outcome === "away") winner = market.awayTeam;

    const text = `RESULT! ${market.homeTeam} ${homeStr} — ${awayStr} ${market.awayTeam}. ${winner} wins! 🏆 Pool: ${totalSats.toLocaleString()} sats. ${market.league}\n\nMore markets → pwsats.com`;

    const imageBase64 = await generateSportMarketCard({
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      league: market.league,
      sport: market.sport,
      startsAt: market.startsAt.toISOString(),
      homeBadge: market.homeBadge ?? undefined,
      awayBadge: market.awayBadge ?? undefined,
      homeSats: market.homeSats,
      drawSats: market.drawSats,
      awaySats: market.awaySats,
      status: "settled",
      homeScore: market.homeScore,
      awayScore: market.awayScore,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "result"],
      ["t", market.sport.toLowerCase().replace(" ", "_")],
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
  country: string;
  question: string;
  date: string;
  threshold: number;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const text = `New weather market! ${market.question}\n\n${market.city}, ${market.country} · ${market.date} · Threshold: ${market.threshold}°C\n\nBet YES or NO with Lightning ⚡\n\npwsats.com`;

    const imageBase64 = await generateWeatherMarketCard({
      city: market.city,
      country: market.country,
      question: market.question,
      date: market.date,
      threshold: market.threshold,
      yesSats: 0,
      noSats: 0,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", "weather"],
    ];

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
  country: string;
  question: string;
  date: string;
  threshold: number;
  resolvedValue: string | null;
  yesSats: number;
  noSats: number;
}): Promise<void> {
  if (!isEnabled()) return;

  try {
    const totalSats = market.yesSats + market.noSats;

    const text = `Weather result! ${market.question}\n\nActual: ${market.resolvedValue ?? "N/A"} · Pool: ${totalSats.toLocaleString()} sats\n\n${market.city} · More markets → pwsats.com`;

    const imageBase64 = await generateWeatherMarketCard({
      city: market.city,
      country: market.country,
      question: market.question,
      date: market.date,
      threshold: market.threshold,
      yesSats: market.yesSats,
      noSats: market.noSats,
      status: "settled",
      resolvedValue: market.resolvedValue,
    });

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "weather"],
      ["t", "result"],
    ];

    await publishNostrPostWithImage(text, imageBase64, tags);
  } catch (err) {
    logger.warn({ err, marketId: market.id }, "Failed to publish weather market settlement to Nostr");
  }
}
