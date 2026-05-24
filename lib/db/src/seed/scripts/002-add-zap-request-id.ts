import { sql } from "drizzle-orm";
import { registerSeed } from "@workspace/db/seed";

const scriptId = "002-add-zap-request-id";

registerSeed(scriptId, async (db) => {
  await sql`
    ALTER TABLE sport_bets ADD COLUMN IF NOT EXISTS zap_request_id TEXT;
    ALTER TABLE weather_bets ADD COLUMN IF NOT EXISTS zap_request_id TEXT;
  `;

  console.log("✅ Added zap_request_id columns to sport_bets and weather_bets");
});
