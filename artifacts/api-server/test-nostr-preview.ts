/**
 * Nostr Preview with inline badges — generates card + text with team badge thumbnails.
 * Reads from local DB. Does NOT publish.
 *
 * Run: su - postgres -c 'cd artifacts/api-server && node ../../node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs test-nostr-preview.ts'
 */
import { Pool } from "pg";
import sharp from "sharp";
import https from "node:https";
import { generateSportMarketCard } from "./src/lib/card-image.js";
import fs from "node:fs";

const pool = new Pool({
  host: "/var/run/postgresql",
  database: "pwsats_db",
  user: "postgres",
});

function fetchBadgeBase64(url: string, size: number = 48): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  return new Promise(resolve => {
    const proto = url.startsWith("https") ? https : require("node:http");
    proto.get(url, { signal: ctrl.signal }, res => {
      if (res.statusCode !== 200) { clearTimeout(timer); resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        if (chunks.length > 0 && chunks[0].length + c.length > 200_000) {
          res.destroy(); resolve(null);
        }
        chunks.push(c);
      });
      res.on("end", () => {
        clearTimeout(timer);
        sharp(Buffer.concat(chunks)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png().toBuffer().then(b => resolve(b.toString("base64"))).catch(() => resolve(null));
      });
      res.on("error", () => { clearTimeout(timer); resolve(null); });
    }).on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

function formatUTCDate(d: Date): string {
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${dateStr} at ${timeStr} UTC`;
}

async function main() {
  const { rows } = await pool.query(
    "SELECT home_team, away_team, league, sport, starts_at, total_home_sats, total_draw_sats, total_away_sats, home_badge, away_badge, league_logo FROM sport_markets WHERE status = 'open' ORDER BY starts_at ASC"
  );

  if (!rows.length) {
    console.log("No open markets in DB.");
    await pool.end();
    return;
  }

  const outputDir = "/tmp/nostr-preview";
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`═══ ${rows.length} OPEN MARKET(S) WITH BADGES ═══\n`);

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const d = new Date(m.starts_at);
    const total = Number(m.total_home_sats) + Number(m.total_draw_sats) + Number(m.total_away_sats);

    // Fetch badge thumbnails in parallel
    const [homeBadge, awayBadge] = await Promise.all([
      fetchBadgeBase64(m.home_badge || ""),
      fetchBadgeBase64(m.away_badge || ""),
    ]);

    const homeIcon = homeBadge ? `[📷 ${m.home_team} badge 48x48]` : "";
    const awayIcon = awayBadge ? `[📷 ${m.away_team} badge 48x48]` : "";

    const text = `⚡ New market! ${homeIcon} ${m.home_team} vs ${m.away_team} ${awayIcon}\n\n🏆 ${m.league}\n📅 ${formatUTCDate(d)}\n💰 Pool: ${total.toLocaleString()} sats\n\nBet Home, Draw or Away with Bitcoin Lightning\n\npwsats.com`;

    const tags = [
      ["t", "pwsats"],
      ["t", "bitcoin"],
      ["t", "lightning"],
      ["t", m.sport.toLowerCase().replace(/[\s/]+/g, "_")],
    ];

    console.log(`--- Market ${i + 1}: ${m.home_team} vs ${m.away_team} ---`);
    console.log(`\n📝 TEXT (with inline badge images):`);
    console.log(text);
    console.log(`\n🏷️  TAGS: ${JSON.stringify(tags)}`);

    // Save badge thumbnails for visual reference
    if (homeBadge) {
      const hbPath = `${outputDir}/badge-home-${i + 1}.png`;
      fs.writeFileSync(hbPath, Buffer.from(homeBadge, "base64"));
      console.log(`🖼️  HOME badge: ${hbPath}`);
    }
    if (awayBadge) {
      const abPath = `${outputDir}/badge-away-${i + 1}.png`;
      fs.writeFileSync(abPath, Buffer.from(awayBadge, "base64"));
      console.log(`🖼️  AWAY badge: ${abPath}`);
    }

    // Generate main card
    const imageBase64 = await generateSportMarketCard({
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      league: m.league,
      sport: m.sport,
      startsAt: m.starts_at,
      homeSats: Number(m.total_home_sats) || 0,
      drawSats: Number(m.total_draw_sats) || 0,
      awaySats: Number(m.total_away_sats) || 0,
      homeBadge: m.home_badge || undefined,
      awayBadge: m.away_badge || undefined,
      leagueLogo: m.league_logo || undefined,
    });

    const pngPath = `${outputDir}/open-${i + 1}.png`;
    fs.writeFileSync(pngPath, Buffer.from(imageBase64, "base64"));
    console.log(`🖼️  CARD: ${pngPath} (${Math.round(imageBase64.length * 0.75 / 1024)} KB)`);
    console.log();
  }

  console.log(`✅ All previews saved to: ${outputDir}/`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
