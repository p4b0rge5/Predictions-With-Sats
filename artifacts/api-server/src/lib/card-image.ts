/**
 * Card Image Generator — Reference Card Style
 *
 * Compact landscape cards matching the in-app card layout.
 * Team & league badges downloaded from API with initials fallback.
 *
 * Sport cards:   1080×440
 * Weather cards: 1080×360
 *
 * Returns base64 PNG string (no data: prefix).
 */

import sharp from "sharp";
import { logger } from "./logger";
import https from "node:https";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const W = 1080;
const H_SPORT = 400;
const H_WEATHER = 360;

const WHITE  = "#fafffe";
const MUTED  = "#98a2b3";
const DIM    = "rgba(255,255,255,0.45)";
const HOME_C = "#22c55e";
const DRAW_C = "#eab308";
const AWAY_C = "#3b82f6";
const BTC    = "#f7931a";

const SPORT_TINT: Record<string, { bg: string; accent: string }> = {
  Soccer:             { bg: "#0b1a12", accent: HOME_C },
  Football:           { bg: "#0b1a12", accent: HOME_C },
  "American Football": { bg: "#10101c", accent: "#6366f1" },
  Basketball:         { bg: "#1a170e", accent: "#eab308" },
  Baseball:           { bg: "#1a1010", accent: "#ef4444" },
  Hockey:             { bg: "#0c1420", accent: "#3b82f6" },
  MMA:                { bg: "#1a1010", accent: "#ef4444" },
  "Mixed Martial Arts": { bg: "#1a1010", accent: "#ef4444" },
  Rugby:              { bg: "#1a170e", accent: "#eab308" },
  Tennis:             { bg: "#0c1a15", accent: "#10b981" },
  Cricket:            { bg: "#1a1508", accent: "#f97316" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

// ---------------------------------------------------------------------------
// Image fetch (3s timeout, ≤200KB)
// ---------------------------------------------------------------------------

function fetchImage(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  return new Promise(resolve => {
    https.get(url, { signal: ctrl.signal }, res => {
      if (res.statusCode !== 200) { clearTimeout(timer); resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        if (chunks.length > 0 && chunks[0].length + c.length > 200_000) {
          res.destroy(); resolve(null);
        }
        chunks.push(c);
      });
      res.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString("base64")); });
      res.on("error", () => { clearTimeout(timer); resolve(null); });
    }).on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

async function badgeFragment(url: string | null | undefined, name: string, size: number = 80, circular: boolean = false): Promise<string> {
  if (url && circular) {
    try {
      const data = await fetchImage(url);
      if (data) {
        const r = size / 2;
        return `<defs><clipPath id="bp"><circle cx="${r}" cy="${r}" r="${r-1}"/></clipPath></defs>
        <image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}" clip-path="url(#bp)"/>
        <circle cx="${r}" cy="${r}" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>`;
      }
    } catch { /* fallback */ }
  }
  if (url) {
    try {
      const data = await fetchImage(url);
      if (data) {
        return `<image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>`;
      }
    } catch { /* fallback */ }
  }
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  return `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1f2e" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
  <text x="${cx}" y="${cy + size * 0.17}" text-anchor="middle" font-size="${size * 0.42}" fill="${WHITE}" font-weight="bold" font-family="sans-serif">${esc(initials)}</text>`;
}

// ---------------------------------------------------------------------------
// Sport Market Card  (1080×440)
// ---------------------------------------------------------------------------

export async function generateSportMarketCard(p: {
  homeTeam: string; awayTeam: string; league: string; sport: string;
  startsAt: string | Date;
  homeSats?: number; drawSats?: number; awaySats?: number;
  status?: string; homeScore?: number | null; awayScore?: number | null; outcome?: string | null;
  homeBadge?: string | null; awayBadge?: string | null;
  leagueLogo?: string | null;
}): Promise<string> {
  const H = H_SPORT;
  const settled = p.status === "settled" || (p.outcome !== null && p.outcome !== undefined);
  const tint = SPORT_TINT[p.sport] || SPORT_TINT["Football"];

  const d = typeof p.startsAt === "string" ? new Date(p.startsAt) : p.startsAt;
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  const hasDraw = !["American Football", "Baseball", "MMA", "Mixed Martial Arts"].includes(p.sport);

  // Download all badges in parallel
  const [hb, ab, lb] = await Promise.all([
    badgeFragment(p.homeBadge, p.homeTeam, 80),
    badgeFragment(p.awayBadge, p.awayTeam, 80),
    badgeFragment(p.leagueLogo, p.league, 22, true),
  ]);

  // Layout
  const cx = W / 2;
  const PAD = 24;

  // Bet boxes — these are the anchor for left alignment
  const boxW = hasDraw ? 310 : 490;
  const boxH = 56;
  const boxGap = 20;
  const boxSX = hasDraw ? 35 : 45;
  const b1x = boxSX, b2x = boxSX + boxW + boxGap, b3x = boxSX + (boxW + boxGap) * 2;
  const boxY = 175;

  // League header: logo + name aligned to HOME box left edge (b1x)
  const leagueX = b1x;
  const leagueLogoSize = 22;
  const leagueNameX = leagueX + leagueLogoSize + 8;
  const headerY = 18;

  // Time aligned to right edge of AWAY box
  const timeX = hasDraw ? b3x + boxW : b2x + boxW;

  // Team centers aligned to their outcome boxes
  const homeCenter = b1x + boxW / 2;
  const awayCenter = hasDraw ? b3x + boxW / 2 : b2x + boxW / 2;

  // Team layout
  const badgeSize = 76;
  const badgeY = 42;
  const vsY = 106;
  const teamNameY = 138;
  const labelY = 158;

  // Outcome badge (settled)
  let outcomeEl = "";
  if (settled) {
    let lbl = "DRAW", clr = DRAW_C;
    if (p.outcome === "home") { lbl = "HOME WIN"; clr = HOME_C; }
    else if (p.outcome === "away") { lbl = "AWAY WIN"; clr = AWAY_C; }
    outcomeEl = `<rect x="${cx - 140}" y="0" width="280" height="20" rx="6" fill="${clr}" fill-opacity="0.15" stroke="${clr}" stroke-width="1.5"/>
    <text x="${cx}" y="15" text-anchor="middle" font-size="12" fill="${clr}" font-weight="bold" font-family="sans-serif" letter-spacing="1">${esc(lbl)}</text>`;
  }

  // Score / VS
  const hSc = p.homeScore != null ? String(p.homeScore) : "—";
  const aSc = p.awayScore != null ? String(p.awayScore) : "—";
  const vsOrScore = settled
    ? `<text x="${cx}" y="${vsY}" text-anchor="middle" font-size="52" fill="${WHITE}" font-weight="bold" font-family="sans-serif">${hSc} — ${aSc}</text>`
    : `<text x="${cx}" y="${vsY}" text-anchor="middle" font-size="32" fill="${MUTED}" font-weight="bold" font-family="sans-serif" letter-spacing="6">VS</text>`;

  // Team names
  const teams = `
  <text x="${homeCenter}" y="${teamNameY}" text-anchor="middle" font-size="22" fill="${WHITE}" font-weight="bold" font-family="sans-serif">${esc(p.homeTeam)}</text>
  <text x="${homeCenter}" y="${labelY}" text-anchor="middle" font-size="10" fill="${DIM}" font-family="sans-serif" letter-spacing="2">HOME</text>
  <text x="${awayCenter}" y="${teamNameY}" text-anchor="middle" font-size="22" fill="${WHITE}" font-weight="bold" font-family="sans-serif">${esc(p.awayTeam)}</text>
  <text x="${awayCenter}" y="${labelY}" text-anchor="middle" font-size="10" fill="${DIM}" font-family="sans-serif" letter-spacing="2">AWAY</text>`;

  // Bet boxes — label only, no sats
  const betBoxes = hasDraw
    ? `<rect x="${b1x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${HOME_C}" fill-opacity="0.10" stroke="${HOME_C}" stroke-width="1.5"/>
    <text x="${b1x + boxW/2}" y="${boxY + 34}" text-anchor="middle" font-size="17" fill="${HOME_C}" font-weight="bold" font-family="sans-serif">↑ HOME</text>
    <rect x="${b2x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${DRAW_C}" fill-opacity="0.10" stroke="${DRAW_C}" stroke-width="1.5"/>
    <text x="${b2x + boxW/2}" y="${boxY + 34}" text-anchor="middle" font-size="17" fill="${DRAW_C}" font-weight="bold" font-family="sans-serif">= DRAW</text>
    <rect x="${b3x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${AWAY_C}" fill-opacity="0.10" stroke="${AWAY_C}" stroke-width="1.5"/>
    <text x="${b3x + boxW/2}" y="${boxY + 34}" text-anchor="middle" font-size="17" fill="${AWAY_C}" font-weight="bold" font-family="sans-serif">↓ AWAY</text>`
    : `<rect x="${b1x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${HOME_C}" fill-opacity="0.10" stroke="${HOME_C}" stroke-width="1.5"/>
    <text x="${b1x + boxW/2}" y="${boxY + 34}" text-anchor="middle" font-size="17" fill="${HOME_C}" font-weight="bold" font-family="sans-serif">↑ HOME</text>
    <rect x="${b2x}" y="${boxY}" width="${boxW}" height="${boxH}" rx="8" fill="${AWAY_C}" fill-opacity="0.10" stroke="${AWAY_C}" stroke-width="1.5"/>
    <text x="${b2x + boxW/2}" y="${boxY + 34}" text-anchor="middle" font-size="17" fill="${AWAY_C}" font-weight="bold" font-family="sans-serif">↓ AWAY</text>`;

  // CTA below boxes, guide below CTA — balanced spacing
  const gap = 28;
  const ctaY = boxY + boxH + gap;
  const ctaH = 36;
  const guideY = ctaY + ctaH + gap;

  const guideText = settled
    ? `<text x="${cx}" y="${guideY}" text-anchor="middle" font-size="12" fill="${MUTED}" font-family="sans-serif">Winners split the pool (2% fee) · Payouts via Lightning</text>`
    : `<text x="${cx}" y="${guideY}" text-anchor="middle" font-size="12" fill="${MUTED}" font-family="sans-serif">Pick an outcome · Pay via Lightning (min $0.50) · Winners split the pool (2% fee)</text>
  <text x="${cx}" y="${guideY + 15}" text-anchor="middle" font-size="10" fill="${DIM}" font-family="sans-serif">No account · Wallet in/out · Transparent pools · Lightning-fast · Provably fair</text>`;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${tint.bg}"/>
  <rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="${tint.accent}" stroke-opacity="0.20" stroke-width="1.5" rx="8"/>

  <!-- Header: league logo + name aligned to HOME box, time on right -->
  <g transform="translate(${leagueX}, ${headerY - 5})">${lb}</g>
  <text x="${leagueNameX}" y="${headerY + 5}" font-size="11" fill="${DIM}" font-family="sans-serif" letter-spacing="2">${esc(p.league.toUpperCase())}</text>
  <text x="${timeX}" y="${headerY + 5}" text-anchor="end" font-size="11" fill="${DIM}" font-family="sans-serif">🕐 ${settled ? "SETTLED" : `${dateStr}, ${timeStr}`}</text>

  ${outcomeEl}

  <!-- Team badges -->
  <g transform="translate(${homeCenter - badgeSize/2}, ${badgeY})">${hb}</g>
  <g transform="translate(${awayCenter - badgeSize/2}, ${badgeY})">${ab}</g>

  <!-- VS / Score -->
  ${vsOrScore}

  <!-- Team names -->
  ${teams}

  <!-- Bet boxes -->
  ${betBoxes}

  <!-- CTA -->
  <rect x="${cx - 240}" y="${ctaY}" width="480" height="${ctaH}" rx="18" fill="${BTC}"/>
  <text x="${cx}" y="${ctaY + 25}" text-anchor="middle" font-size="16" fill="#fff" font-weight="bold" font-family="sans-serif">
    ${settled ? "RESULTS ANNOUNCED" : "BET NOW → pwsats.com"}</text>

  <!-- Guide -->
  ${guideText}
</svg>`;

  return svgToBase64Png(svg, H);
}

// ---------------------------------------------------------------------------
// Weather Market Card  (1080×360)
// ---------------------------------------------------------------------------

export async function generateWeatherMarketCard(p: {
  city: string; question: string; threshold: string | number;
  yesSats?: number; noSats?: number;
  status?: string; resolvedValue?: string | null;
}): Promise<string> {
  const H = H_WEATHER;
  const settled = p.status === "settled";
  const tint = { bg: "#0c1420", accent: "#3b82f6" };
  const threshold = typeof p.threshold === "number" ? `${p.threshold}°C` : p.threshold;
  const cx = W / 2;

  const boxW = 490, boxH = 56, boxGap = 20;
  const b1x = 20, b2x = 20 + boxW + boxGap;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${tint.bg}"/>
  <rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" fill="none" stroke="${tint.accent}" stroke-opacity="0.20" stroke-width="1.5" rx="8"/>

  <text x="${cx}" y="28" text-anchor="middle" font-size="11" fill="${DIM}" font-family="sans-serif" letter-spacing="2">WEATHER MARKET</text>
  <text x="${cx}" y="78" text-anchor="middle" font-size="36" fill="${WHITE}" font-weight="bold" font-family="sans-serif">${esc(p.city)}</text>
  <text x="${cx}" y="112" text-anchor="middle" font-size="18" fill="${MUTED}" font-family="sans-serif">${esc(p.question)}</text>
  <text x="${cx}" y="135" text-anchor="middle" font-size="13" fill="${DIM}" font-family="sans-serif">Threshold: ${esc(threshold)}</text>

  ${settled && p.resolvedValue ? `<rect x="${cx - 140}" y="145" width="280" height="28" rx="8" fill="${HOME_C}" fill-opacity="0.12" stroke="${HOME_C}" stroke-width="1.5"/>
  <text x="${cx}" y="165" text-anchor="middle" font-size="14" fill="${HOME_C}" font-weight="bold" font-family="sans-serif">RESULT: ${esc(String(p.resolvedValue))}</text>` : ""}

  <rect x="${b1x}" y="185" width="${boxW}" height="${boxH}" rx="8" fill="${HOME_C}" fill-opacity="0.10" stroke="${HOME_C}" stroke-width="1.5"/>
  <text x="${b1x + boxW/2}" y="${185 + 34}" text-anchor="middle" font-size="17" fill="${HOME_C}" font-weight="bold" font-family="sans-serif">YES</text>
  <rect x="${b2x}" y="185" width="${boxW}" height="${boxH}" rx="8" fill="${AWAY_C}" fill-opacity="0.10" stroke="${AWAY_C}" stroke-width="1.5"/>
  <text x="${b2x + boxW/2}" y="${185 + 34}" text-anchor="middle" font-size="17" fill="${AWAY_C}" font-weight="bold" font-family="sans-serif">NO</text>

  <text x="${cx}" y="${185 + boxH + 16}" text-anchor="middle" font-size="13" fill="${MUTED}" font-family="sans-serif">
    ${settled ? "Winners split the pool (2% fee) · Claim via Lightning QR" : "Pick YES or NO · Pay via Lightning (min $0.50) · Winners split the pool (2% fee)"}</text>

  <rect x="${cx - 240}" y="${185 + boxH + 36}" width="480" height="36" rx="18" fill="${BTC}"/>
  <text x="${cx}" y="${185 + boxH + 36 + 25}" text-anchor="middle" font-size="16" fill="#fff" font-weight="bold" font-family="sans-serif">
    ${settled ? "RESULTS ANNOUNCED" : "BET NOW → pwsats.com"}</text>
</svg>`;

  return svgToBase64Png(svg, H);
}

// ---------------------------------------------------------------------------
// Rasterize SVG → base64 PNG
// ---------------------------------------------------------------------------

function svgToBase64Png(svgString: string, h: number): Promise<string> {
  return sharp(Buffer.from(svgString), {
    limitInputPixels: W * h * 2,
  })
    .resize(W, h)
    .png({ compressionLevel: 9 })
    .toBuffer()
    .then(b => b.toString("base64"))
    .catch(err => {
      logger.error({ err }, "Failed to rasterize SVG card");
      throw err;
    });
}
