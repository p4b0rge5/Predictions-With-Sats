import { Router } from "express";
import { testNostrPost } from "../lib/nostr";
import { publishSportMarketCreated } from "../lib/nostr-publisher";
import { db, sportMarketsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

// GET /api/admin/nostr/status
router.get("/status", (_req, res) => {
  const hasKey = !!process.env.NOSTR_PRIVATE_KEY;
  const relays = process.env.NOSTR_RELAYS
    ? process.env.NOSTR_RELAYS.split(",").map((r) => r.trim())
    : ["relay.nostr.band", "nos.lol", "relay.nosver.se", "purplepag.es"];

  return res.json({
    enabled: hasKey,
    relays,
    publicKey: hasKey ? null : "set NOSTR_PRIVATE_KEY to activate",
  });
});

// POST /api/admin/nostr/test
router.post("/test", async (_req, res) => {
  try {
    const result = await testNostrPost();
    return res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

// POST /api/admin/nostr/test-market
// Publishes a test card for the most recent sport market
router.post("/test-market", async (_req, res) => {
  try {
    const [latest] = await db
      .select()
      .from(sportMarketsTable)
      .orderBy(desc(sportMarketsTable.createdAt))
      .limit(1);

    if (!latest) {
      return res.status(404).json({ error: "No sport markets found" });
    }

    await publishSportMarketCreated({
      id: latest.id,
      homeTeam: latest.homeTeam,
      awayTeam: latest.awayTeam,
      league: latest.league,
      sport: latest.sport,
      startsAt: latest.startsAt,
      homeBadge: latest.homeBadge ?? undefined,
      awayBadge: latest.awayBadge ?? undefined,
    });

    return res.json({ success: true, marketId: latest.id, message: "Test market post published to Nostr" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

export default router;
