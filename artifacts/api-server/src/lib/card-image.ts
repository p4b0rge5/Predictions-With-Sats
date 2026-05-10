/**
 * Card Image Generator
 *
 * Creates visually appealing card images for PWSats events using SVG templates
 * rasterized with sharp. No native font rendering — everything is pure SVG.
 *
 * Output: 1080x1080 PNG (square, optimal for Nostr/social media)
 */

import sharp from "sharp";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIDTH = 1080;
const HEIGHT = 1080;

// Colors
const BG_GRADIENT_TOP = "#0a0e1a";
const BG_GRADIENT_BOTTOM = "#141d33";
const ACCENT = "#f7931a"; // Bitcoin orange
const ACCENT_GLOW = "rgba(247, 147, 26, 0.15)";
const TEXT_WHITE = "#ffffff";
const TEXT_LIGHT = "#c8d0e0";
const TEXT_MUTED = "#6b7a99";
const BORDER_COLOR = "rgba(247, 147, 26, 0.3)";

// Sport icons
const SPORT_ICONS: Record<string, string> = {
  Soccer: "⚽",
  Football: "⚽",
  "American Football": "🏈",
  Basketball: "🏀",
  Baseball: "⚾",
  Hockey: "🏒",
  MMA: "🥊",
  "Mixed Martial Arts": "🥊",
  Rugby: "🏉",
  Tennis: "🎾",
  Cricket: "🏏",
  Weather: "🌤️",
};

// ---------------------------------------------------------------------------
// SVG Template Engine
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapTextForSvg(
  text: string,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
): string[] {
  // Rough character count per line (avg char width ~ fontSize * 0.55 for sans-serif)
  const charsPerLine = Math.floor(maxWidth / (fontSize * 0.55));
  if (text.length <= charsPerLine) return [text];

  const lines: string[] = [];
  const words = text.split(" ");
  let currentLine = "";

  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (test.length > charsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function buildSportMarketSvg(market: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  startsAt: string;
  homeBadge?: string;
  awayBadge?: string;
  homeSats?: number;
  drawSats?: number;
  awaySats?: number;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
}): string {
  const icon = SPORT_ICONS[market.sport] || "🏆";
  const formattedDate = new Date(market.startsAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const formattedTime = new Date(market.startsAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const isSettled = market.status === "settled";

  // Score display for settled markets
  let scoreRow = "";
  if (isSettled && market.homeScore != null && market.awayScore != null) {
    scoreRow = `
      <text x="540" y="370" text-anchor="middle" font-size="56" fill="${TEXT_WHITE}" font-weight="bold" font-family="sans-serif">
        ${escapeXml(String(market.homeScore))} — ${escapeXml(String(market.awayScore))}
      </text>
      <text x="540" y="420" text-anchor="middle" font-size="28" fill="${TEXT_MUTED}" font-family="sans-serif">
        FINAL
      </text>`;
  }

  // Team name wrapping
  const teamMaxWidth = 380;
  const homeLines = wrapTextForSvg(market.homeTeam, teamMaxWidth, 48, 56);
  const awayLines = wrapTextForSvg(market.awayTeam, teamMaxWidth, 48, 56);

  const homeNameY = 320;
  const awayNameY = 500;

  const homeNameSvg = homeLines
    .map((line, i) => `<text x="170" y="${homeNameY + i * 56}" text-anchor="middle" font-size="48" fill="${TEXT_WHITE}" font-weight="bold" font-family="sans-serif">${escapeXml(line)}</text>`)
    .join("\n      ");

  const awayNameSvg = awayLines
    .map((line, i) => `<text x="710" y="${awayNameY + i * 56}" text-anchor="middle" font-size="48" fill="${TEXT_WHITE}" font-weight="bold" font-family="sans-serif">${escapeXml(line)}</text>`)
    .join("\n      ");

  // League name wrapping (shorter)
  const leagueLines = wrapTextForSvg(market.league, 800, 30, 36);
  const leagueSvg = leagueLines
    .map((line, i) => `<text x="540" y="190 + ${i * 36}" text-anchor="middle" font-size="30" fill="${TEXT_MUTED}" font-family="sans-serif">${escapeXml(line)}</text>`)
    .join("\n      ");

  const leagueY = 190;

  // Betting pool display
  const hsats = market.homeSats ?? 0;
  const dsats = market.drawSats ?? 0;
  const asats = market.awaySats ?? 0;
  const totalSats = hsats + dsats + asats;

  // VS circle
  const vsText = isSettled ? "VS" : "VS";

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_GRADIENT_TOP}"/>
      <stop offset="100%" stop-color="${BG_GRADIENT_BOTTOM}"/>
    </linearGradient>
    <!-- Accent gradient for header -->
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#d4780e"/>
      <stop offset="50%" stop-color="#f7931a"/>
      <stop offset="100%" stop-color="#d4780e"/>
    </linearGradient>
    <!-- Glow filter -->
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <!-- Shadow -->
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.4)"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Subtle grid pattern -->
  <g opacity="0.03">
    ${Array.from({ length: 24 }, (_, i) =>
    `<line x1="${i * 45}" y1="0" x2="${i * 45}" y2="${HEIGHT}" stroke="white" stroke-width="1"/>`
  ).join("")}
    ${Array.from({ length: 24 }, (_, i) =>
    `<line x1="0" y1="${i * 45}" x2="${WIDTH}" y2="${i * 45}" stroke="white" stroke-width="1"/>`
  ).join("")}
  </g>

  <!-- Accent header bar -->
  <rect x="0" y="0" width="${WIDTH}" height="100" fill="url(#accent)" opacity="0.9"/>
  <rect x="0" y="98" width="${WIDTH}" height="4" fill="${ACCENT}"/>

  <!-- Brand -->
  <text x="540" y="60" text-anchor="middle" font-size="42" fill="white" font-weight="bold" font-family="sans-serif">
    PREDICTIONS WITH SATS
  </text>
  <text x="540" y="88" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.7)" font-family="sans-serif">
    ⚡ Bet with Bitcoin Lightning
  </text>

  <!-- Sport icon -->
  <text x="540" y="150" text-anchor="middle" font-size="52">${icon}</text>

  <!-- League -->
  ${leagueSvg}

  <!-- Home team badge placeholder -->
  ${market.homeBadge
    ? `<image x="100" y="460" width="140" height="140" href="${escapeXml(market.homeBadge)}" preserveAspectRatio="xMidYMid meet"/>`
    : `<circle cx="170" cy="530" r="50" fill="${ACCENT_GLOW}" stroke="${BORDER_COLOR}" stroke-width="2"/>
       <text x="170" y="545" text-anchor="middle" font-size="36" fill="${ACCENT}" font-family="sans-serif">🏠</text>`}

  <!-- Away team badge placeholder -->
  ${market.awayBadge
    ? `<image x="740" y="460" width="140" height="140" href="${escapeXml(market.awayBadge)}" preserveAspectRatio="xMidYMid meet"/>`
    : `<circle cx="710" cy="530" r="50" fill="${ACCENT_GLOW}" stroke="${BORDER_COLOR}" stroke-width="2"/>
       <text x="710" y="545" text-anchor="middle" font-size="36" fill="${ACCENT}" font-family="sans-serif">✈️</text>`}

  <!-- Team names -->
  ${homeNameSvg}

  <!-- VS circle -->
  <circle cx="540" cy="420" r="45" fill="${ACCENT}" filter="url(#glow)"/>
  <text x="540" y="435" text-anchor="middle" font-size="36" fill="white" font-weight="bold" font-family="sans-serif">${vsText}</text>

  <!-- Away team name -->
  ${awayNameSvg}

  <!-- Score (if settled) -->
  ${scoreRow}

  <!-- Date / Time -->
  ${!isSettled ? `
  <text x="540" y="710" text-anchor="middle" font-size="32" fill="${TEXT_LIGHT}" font-family="sans-serif">
    📅 ${escapeXml(formattedDate)} · 🕐 ${escapeXml(formattedTime)} UTC
  </text>` : ""}

  <!-- Betting pool -->
  ${totalSats > 0 ? `
  <!-- Pool section background -->
  <rect x="120" y="760" width="840" height="140" rx="16" fill="rgba(255,255,255,0.03)" stroke="${BORDER_COLOR}" stroke-width="1"/>

  <!-- Pool total -->
  <text x="540" y="800" text-anchor="middle" font-size="24" fill="${TEXT_MUTED}" font-family="sans-serif">
    TOTAL POOL
  </text>
  <text x="540" y="840" text-anchor="middle" font-size="40" fill="${ACCENT}" font-weight="bold" font-family="sans-serif">
    ${totalSats.toLocaleString()} sats
  </text>

  <!-- Three columns: Home | Draw | Away -->
  <text x="270" y="870" text-anchor="middle" font-size="20" fill="${TEXT_LIGHT}" font-family="sans-serif">🏠 ${hsats.toLocaleString()}s</text>
  <text x="540" y="870" text-anchor="middle" font-size="20" fill="${TEXT_LIGHT}" font-family="sans-serif">Draw ${dsats.toLocaleString()}s</text>
  <text x="810" y="870" text-anchor="middle" font-size="20" fill="${TEXT_LIGHT}" font-family="sans-serif">✈️ ${asats.toLocaleString()}s</text>` : ""}

  <!-- CTA -->
  <rect x="240" y="${isSettled ? 900 : totalSats > 0 ? 940 : 780}" width="600" height="60" rx="30" fill="url(#accent)" filter="url(#shadow)"/>
  <text x="540" y="970" text-anchor="middle" font-size="30" fill="white" font-weight="bold" font-family="sans-serif">
    ${isSettled ? "RESULTS ANNOUNCED" : "BET NOW → pwsats.com"}
  </text>

  <!-- Footer -->
  <text x="540" y="1040" text-anchor="middle" font-size="18" fill="${TEXT_MUTED}" font-family="sans-serif">
    ⚡ Lightning-fast Bitcoin betting · No KYC
  </text>
</svg>`;
}

function buildWeatherMarketSvg(market: {
  city: string;
  country: string;
  question: string;
  date: string;
  threshold: number;
  yesSats?: number;
  noSats?: number;
  status?: string;
  resolvedValue?: string | null;
}): string {
  const icon = "🌤️";
  const totalSats = (market.yesSats ?? 0) + (market.noSats ?? 0);
  const isSettled = market.status === "settled";
  const questionLines = wrapTextForSvg(market.question, 900, 32, 40);

  const questionSvg = questionLines
    .map((line, i) => `<text x="540" y="${280 + i * 42}" text-anchor="middle" font-size="32" fill="${TEXT_WHITE}" font-family="sans-serif">${escapeXml(line)}</text>`)
    .join("\n      ");

  let resolvedSvg = "";
  if (isSettled && market.resolvedValue) {
    resolvedSvg = `
    <rect x="240" y="440" width="600" height="100" rx="16" fill="rgba(247,147,26,0.1)" stroke="${ACCENT}" stroke-width="2"/>
    <text x="540" y="480" text-anchor="middle" font-size="24" fill="${TEXT_MUTED}" font-family="sans-serif">RESOLVED</text>
    <text x="540" y="520" text-anchor="middle" font-size="36" fill="${ACCENT}" font-weight="bold" font-family="sans-serif">${escapeXml(String(market.resolvedValue))}</text>`;
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BG_GRADIENT_TOP}"/>
      <stop offset="100%" stop-color="${BG_GRADIENT_BOTTOM}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#d4780e"/>
      <stop offset="50%" stop-color="#f7931a"/>
      <stop offset="100%" stop-color="#d4780e"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(0,0,0,0.4)"/>
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Subtle grid -->
  <g opacity="0.03">
    ${Array.from({ length: 24 }, (_, i) =>
    `<line x1="${i * 45}" y1="0" x2="${i * 45}" y2="${HEIGHT}" stroke="white" stroke-width="1"/>`
  ).join("")}
    ${Array.from({ length: 24 }, (_, i) =>
    `<line x1="0" y1="${i * 45}" x2="${WIDTH}" y2="${i * 45}" stroke="white" stroke-width="1"/>`
  ).join("")}
  </g>

  <!-- Header bar -->
  <rect x="0" y="0" width="${WIDTH}" height="100" fill="url(#accent)" opacity="0.9"/>
  <rect x="0" y="98" width="${WIDTH}" height="4" fill="${ACCENT}"/>

  <text x="540" y="60" text-anchor="middle" font-size="42" fill="white" font-weight="bold" font-family="sans-serif">
    PREDICTIONS WITH SATS
  </text>
  <text x="540" y="88" text-anchor="middle" font-size="20" fill="rgba(255,255,255,0.7)" font-family="sans-serif">
    ⚡ Bet with Bitcoin Lightning
  </text>

  <!-- Weather icon -->
  <text x="540" y="170" text-anchor="middle" font-size="64">${icon}</text>

  <!-- Location -->
  <text x="540" y="220" text-anchor="middle" font-size="36" fill="${ACCENT}" font-weight="bold" font-family="sans-serif">
    ${escapeXml(market.city)}${market.country ? `, ${escapeXml(market.country)}` : ""}
  </text>

  <!-- Date -->
  <text x="540" y="260" text-anchor="middle" font-size="24" fill="${TEXT_MUTED}" font-family="sans-serif">
    📅 ${escapeXml(market.date)}
  </text>

  <!-- Question -->
  ${questionSvg}

  <!-- Threshold -->
  ${market.threshold ? `
  <text x="540" y="${280 + questionLines.length * 42 + 20}" text-anchor="middle" font-size="24" fill="${TEXT_LIGHT}" font-family="sans-serif">
    Threshold: ${market.threshold}°C
  </text>` : ""}

  <!-- Resolved value -->
  ${resolvedSvg}

  <!-- Pool -->
  ${totalSats > 0 ? `
  <rect x="120" y="${isSettled ? 580 : 480}" width="840" height="140" rx="16" fill="rgba(255,255,255,0.03)" stroke="${BORDER_COLOR}" stroke-width="1"/>
  <text x="540" y="${isSettled ? 620 : 520}" text-anchor="middle" font-size="24" fill="${TEXT_MUTED}" font-family="sans-serif">TOTAL POOL</text>
  <text x="540" y="${isSettled ? 660 : 560}" text-anchor="middle" font-size="40" fill="${ACCENT}" font-weight="bold" font-family="sans-serif">${totalSats.toLocaleString()} sats</text>
  <text x="370" y="${isSettled ? 690 : 590}" text-anchor="middle" font-size="20" fill="${TEXT_LIGHT}" font-family="sans-serif">YES ${(market.yesSats ?? 0).toLocaleString()}s</text>
  <text x="710" y="${isSettled ? 690 : 590}" text-anchor="middle" font-size="20" fill="${TEXT_LIGHT}" font-family="sans-serif">NO ${(market.noSats ?? 0).toLocaleString()}s</text>` : ""}

  <!-- CTA -->
  <rect x="240" y="${isSettled ? 740 : totalSats > 0 ? 940 : 620}" width="600" height="60" rx="30" fill="url(#accent)" filter="url(#shadow)"/>
  <text x="540" y="970" text-anchor="middle" font-size="30" fill="white" font-weight="bold" font-family="sans-serif">
    ${isSettled ? "RESULTS ANNOUNCED" : "BET NOW → pwsats.com"}
  </text>

  <!-- Footer -->
  <text x="540" y="1040" text-anchor="middle" font-size="18" fill="${TEXT_MUTED}" font-family="sans-serif">
    ⚡ Lightning-fast Bitcoin betting · No KYC
  </text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

async function svgToPngBuffer(svgString: string): Promise<Buffer> {
  return sharp(Buffer.from(svgString), {
    limitInputPixels: WIDTH * HEIGHT * 2,
  })
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateSportMarketCard(market: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  sport: string;
  startsAt: string;
  homeBadge?: string;
  awayBadge?: string;
  homeSats?: number;
  drawSats?: number;
  awaySats?: number;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
}): Promise<string> {
  const svg = buildSportMarketSvg(market);
  const buffer = await svgToPngBuffer(svg);
  return buffer.toString("base64");
}

export async function generateWeatherMarketCard(market: {
  city: string;
  country: string;
  question: string;
  date: string;
  threshold: number;
  yesSats?: number;
  noSats?: number;
  status?: string;
  resolvedValue?: string | null;
}): Promise<string> {
  const svg = buildWeatherMarketSvg(market);
  const buffer = await svgToPngBuffer(svg);
  return buffer.toString("base64");
}
