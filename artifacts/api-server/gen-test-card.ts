/**
 * Generate a single test card PNG and save to disk.
 */
import { generateSportMarketCard } from "./src/lib/card-image";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const imageBase64 = await generateSportMarketCard({
    homeTeam: "Real Madrid",
    awayTeam: "FC Barcelona",
    league: "La Liga",
    sport: "Soccer",
    startsAt: new Date("2026-05-14T20:00:00Z"),
    homeSats: 1200,
    drawSats: 500,
    awaySats: 850,
    homeBadge: "https://media.api-sports.io/football/teams/541.png",
    awayBadge: "https://media.api-sports.io/football/teams/529.png",
    leagueLogo: "https://media.api-sports.io/football/leagues/140.png",
  });

  const outputDir = path.join("/opt/baal-agent/workspace/Predictions-With-Sats/cards");
  fs.mkdirSync(outputDir, { recursive: true });

  const outPath = path.join(outputDir, "test-open-market.png");
  fs.writeFileSync(outPath, Buffer.from(imageBase64, "base64"));

  const size = Math.round(imageBase64.length * 0.75 / 1024);
  console.log(`✅ Card saved: ${outPath} (${size} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
