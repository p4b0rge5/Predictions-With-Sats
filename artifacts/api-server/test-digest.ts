// Load .env manually
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

// Import ONLY the schema file — avoid the seed module which has a circular dependency bug
import { sportMarketsTable } from "../../lib/db/src/schema/sport-markets.js";
import { generateMarketDigestText } from "./src/lib/nostr-digest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../.env");
const envContent = fs.readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#][^=]+)=(.*)$/);
  if (m) {
    const key = m[1].trim();
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const openMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.status, "open"))
    .orderBy(desc(sportMarketsTable.startsAt));

  const settledMarkets = await db
    .select()
    .from(sportMarketsTable)
    .where(eq(sportMarketsTable.status, "settled"))
    .orderBy(desc(sportMarketsTable.settledAt))
    .limit(5);

  console.log("Open markets:", openMarkets.length);
  openMarkets.forEach(m => {
    const total = m.totalHomeSats + m.totalDrawSats + m.totalAwaySats;
    console.log(` - ${m.homeTeam} vs ${m.awayTeam} | ${m.league} | ${m.sport} | ${total} sats`);
  });

  console.log("\nSettled (recent 5):", settledMarkets.length);
  settledMarkets.forEach(m => {
    const total = m.totalHomeSats + m.totalDrawSats + m.totalAwaySats;
    console.log(` - ${m.homeTeam} vs ${m.awayTeam} | ${m.league} | ${m.sport} | ${total} sats | outcome: ${m.outcome}`);
  });

  const allMarkets = openMarkets.length > 0 ? openMarkets : settledMarkets;

  console.log("\n=== DIGEST OUTPUT ===\n");
  const text = generateMarketDigestText(allMarkets);
  console.log(text);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
