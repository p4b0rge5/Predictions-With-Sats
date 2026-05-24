/**
 * Sports Scores REST Poller
 *
 * Replaces the dead WebSocket with polling the Gamma REST API
 * at GET /events/slug/{slug}.
 *
 * Strategy:
 * - Live markets (status='live'): poll every 30s
 * - Open markets (all): poll every 2min
 * - 1s timeout per request, parallel batches of 3
 */

import { db, sportPolyMarketsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger";

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_API_BASE ?? "https://gamma-api.polymarket.com";
const LIVE_POLL_MS = 30_000;
const OPEN_POLL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1_000;
const MAX_CONCURRENT = 3;
const REQUEST_DELAY_MS = 200;

const GAME_OVER_PERIODS = new Set([
  "FT", "VFT", "AET", "PEN", "FINAL", "Final", "ET", "OT", "SO", "Suspended",
]);

const LIVE_PERIODS = new Set([
  "1H", "2H", "HT", "1Q", "2Q", "3Q", "4Q", "Q1", "Q2", "Q3", "Q4",
  "1st", "2nd", "3rd", "4th",
  "Top 1st", "Bot 1st", "Top 2nd", "Bot 2nd", "Top 3rd", "Bot 3rd",
  "Top 4th", "Bot 4th", "Top 5th", "Bot 5th", "Top 6th", "Bot 6th",
  "Top 7th", "Bot 7th", "Top 8th", "Bot 8th", "Top 9th", "Bot 9th",
  "End 1st", "End 2nd", "End 3rd", "End 4th", "End 5th",
  "End 6th", "End 7th", "End 8th", "End 9th",
  "Mid 1st", "Mid 2nd", "Mid 3rd", "Mid 4th", "Mid 5th",
  "Mid 6th", "Mid 7th", "Mid 8th", "Mid 9th",
  "1/0", "2/0", "2/1", "3/0", "3/1", "1/1",
  "SUS",
]);

interface EventScore {
  homeScore: number | null;
  awayScore: number | null;
  period: string | null;
  live: boolean | null;
  ended: boolean | null;
}

class ScoresRestPoller {
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private openTimer: ReturnType<typeof setInterval> | null = null;
  private settledTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastOpenFetch = 0;
  private lastSettledFetch = 0;

  start(): void {
    if (this.liveTimer) return;
    this.running = true;
    logger.info("Sports REST scores poller: starting");

    // One-time backfill for settled markets that never got a live score
    this.fetchSettledScores().catch(() => {});

    this.fetchLiveScores().catch(() => {});

    this.liveTimer = setInterval(() => {
      this.fetchLiveScores().catch(() => {});
    }, LIVE_POLL_MS);

    this.openTimer = setInterval(() => {
      this.fetchOpenScores().catch(() => {});
    }, OPEN_POLL_MS);

    this.settledTimer = setInterval(() => {
      this.fetchSettledScores().catch(() => {});
    }, 10 * 60 * 1000); // every 10 min — rare, for newly-settled games

    logger.info(
      { livePollMs: LIVE_POLL_MS, openPollMs: OPEN_POLL_MS },
      "Sports REST scores poller: timers configured",
    );
  }

  stop(): void {
    this.running = false;
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
    if (this.openTimer) { clearInterval(this.openTimer); this.openTimer = null; }
    if (this.settledTimer) { clearInterval(this.settledTimer); this.settledTimer = null; }
    logger.info("Sports REST scores poller: stopped");
  }

  private async fetchLiveScores(): Promise<void> {
    if (!this.running) return;
    try {
      const markets = await db
        .select({
          id: sportPolyMarketsTable.id,
          sourceUrl: sportPolyMarketsTable.sourceUrl,
        })
        .from(sportPolyMarketsTable)
        .where(eq(sportPolyMarketsTable.status, "live"));

      await this.fetchAndApplyBatch(markets, "live");
    } catch (err) {
      logger.error({ err }, "Sports REST scores: live fetch failed");
    }
  }

  private async fetchSettledScores(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    if (now - this.lastSettledFetch < 10 * 60 * 1000) return;
    this.lastSettledFetch = now;

    try {
      const markets = await db
        .select({
          id: sportPolyMarketsTable.id,
          sourceUrl: sportPolyMarketsTable.sourceUrl,
        })
        .from(sportPolyMarketsTable)
        .where(
          and(
            eq(sportPolyMarketsTable.status, "settled"),
            isNull(sportPolyMarketsTable.homeScore),
          ),
        );

      if (markets.length === 0) return;
      await this.fetchAndApplyBatch(markets, "settled");
    } catch (err) {
      logger.error({ err }, "Sports REST scores: settled fetch failed");
    }
  }

  private async fetchOpenScores(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    if (now - this.lastOpenFetch < OPEN_POLL_MS) return;
    this.lastOpenFetch = now;

    try {
      const markets = await db
        .select({
          id: sportPolyMarketsTable.id,
          sourceUrl: sportPolyMarketsTable.sourceUrl,
          startsAt: sportPolyMarketsTable.startsAt,
        })
        .from(sportPolyMarketsTable)
        .where(eq(sportPolyMarketsTable.status, "open"))
        .orderBy(asc(sportPolyMarketsTable.startsAt));

      if (markets.length === 0) return;
      
      // First, mark markets as "live" if their startsAt is in the past and no scores yet
      // This handles cases where the API doesn't provide real-time scores but the game has started
      const pastStarts = markets.filter(m => m.startsAt < new Date());
      for (const m of pastStarts) {
        try {
          await db
            .update(sportPolyMarketsTable)
            .set({ status: "live" })
            .where(eq(sportPolyMarketsTable.id, m.id));
          logger.info(
            { marketId: m.id, startsAt: m.startsAt },
            "Sports REST scores: marked as live (start time passed)",
          );
        } catch (err) {
          logger.error({ err, marketId: m.id }, "Sports REST scores: failed to mark as live");
        }
      }
      
      await this.fetchAndApplyBatch(markets, "open");
    } catch (err) {
      logger.error({ err }, "Sports REST scores: open fetch failed");
    }
  }

  private async fetchAndApplyBatch(
    markets: Array<{ id: number; sourceUrl: string | null }>,
    source: string,
  ): Promise<void> {
    const unique = new Map<string, number[]>();
    for (const m of markets) {
      const slug = this.extractSlug(m.sourceUrl);
      if (!slug) continue;
      if (!unique.has(slug)) unique.set(slug, []);
      unique.get(slug)!.push(m.id);
    }

    if (unique.size === 0) return;

    const slugs = Array.from(unique.keys());
    const batchSize = MAX_CONCURRENT;
    let totalUpdated = 0;

    for (let i = 0; i < slugs.length; i += batchSize) {
      if (!this.running) break;

      const batch = slugs.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(slug => this.fetchEvent(slug)),
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].status !== "fulfilled") continue;
        const fulfilled = results[j] as PromiseFulfilledResult<EventScore | null>;
        const result = fulfilled.value;
        if (!result) continue;

        const { homeScore, awayScore, period, live, ended } = result;
        const slug = batch[j];

        const updates: Record<string, unknown> = {};
        if (homeScore !== null) updates.homeScore = homeScore;
        if (awayScore !== null) updates.awayScore = awayScore;
        if (period) updates.period = period;

        if (live && !ended) {
          updates.status = "live";
        } else if (ended || GAME_OVER_PERIODS.has(period ?? "")) {
          updates.status = "settled";
        } else if (period && LIVE_PERIODS.has(period)) {
          updates.status = "live";
        }

        if (Object.keys(updates).length === 0) continue;

        const marketIds = unique.get(slug)!;
        for (const id of marketIds) {
          try {
            const rows = await db
              .update(sportPolyMarketsTable)
              .set(updates)
              .where(eq(sportPolyMarketsTable.id, id))
              .returning({ id: sportPolyMarketsTable.id });

            if (rows.length > 0) {
              totalUpdated++;
              logger.info(
                { marketId: id, slug, homeScore, awayScore, period, live, ended },
                "Sports REST scores: updated",
              );
            }
          } catch (err) {
            logger.error({ err, marketId: id, slug }, "Sports REST scores: DB update failed");
          }
        }
      }

      if (i + batchSize < slugs.length) {
        await this.sleep(REQUEST_DELAY_MS);
      }
    }

    if (totalUpdated > 0) {
      logger.info({ updated: totalUpdated, source }, "Sports REST scores: batch complete");
    }
  }

  private async fetchEvent(slug: string): Promise<EventScore | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(`${GAMMA_BASE}/events/slug/${slug}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (!res.ok) return null;

      const raw = await res.json() as Record<string, unknown>;
      const scoreStr = typeof raw.score === "string" ? raw.score : undefined;
      const period = typeof raw.period === "string" ? raw.period : null;
      const live = typeof raw.live === "boolean" ? raw.live : null;
      const ended = typeof raw.ended === "boolean" ? raw.ended : null;

      if (!scoreStr && !period) return null;

      const { homeScore, awayScore } = this.parseScore(scoreStr);
      return { homeScore, awayScore, period, live, ended };
    } catch {
      return null;
    }
  }

  private extractSlug(sourceUrl: string | null): string | null {
    if (!sourceUrl) return null;
    try {
      const url = new URL(sourceUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }

  private parseScore(scoreStr: string | undefined): { homeScore: number | null; awayScore: number | null } {
    if (!scoreStr || typeof scoreStr !== "string") return { homeScore: null, awayScore: null };

    const parts = scoreStr.split("-");
    if (parts.length !== 2) return { homeScore: null, awayScore: null };

    const h = parseInt(parts[0], 10);
    const a = parseInt(parts[1], 10);

    if (isNaN(h) || isNaN(a)) return { homeScore: null, awayScore: null };
    return { homeScore: h, awayScore: a };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const scoresPoller = new ScoresRestPoller();
export default scoresPoller;
