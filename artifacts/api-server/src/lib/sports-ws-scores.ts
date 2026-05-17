/**
 * Real-time sports scores via Polymarket Sports WebSocket.
 *
 * Connects to wss://sports-api.polymarket.com/ws
 * Receives game state updates (score changes, period changes, game end).
 * Updates sport_poly_markets with home_score, away_score, period, status.
 *
 * No auth, no subscription. Server pings every 5s — respond with "pong".
 *
 * Message format:
 *   { gameId, leagueAbbreviation, homeTeam, awayTeam, score: "H-A", period, status, ended }
 */

import { db, sportPolyMarketsTable } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import { logger } from "./logger";
import WebSocket from "ws";

const WS_URL = "wss://sports-api.polymarket.com/ws";
const PING_INTERVAL_MS = 4_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

/** Map gameId → {homeTeam, awayTeam, league} for matching against DB markets */
interface GameIdentity {
  gameId: number;
  leagueAbbreviation: string;
  homeTeam: string;
  awayTeam: string;
}

class SportsWsScores {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Start the WebSocket connection with auto-reconnect.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("Sports WS scores: starting");
    this.connect();
  }

  /**
   * Stop the WebSocket connection.
   */
  stop(): void {
    this.running = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    logger.info("Sports WS scores: stopped");
  }

  get isRunning(): boolean {
    return this.connected;
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      logger.warn({ err }, "Sports WS scores: failed to create connection");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startPingTimer();
      logger.info("Sports WS scores: connected");
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : event.data.toString();

      if (data === "ping") {
        this.ws?.send("pong");
        return;
      }

      try {
        this.handleMessage(JSON.parse(data));
      } catch (err) {
        logger.warn({ err, raw: data.slice(0, 200) }, "Sports WS scores: parse error");
      }
    };

    this.ws.onclose = (code, reason) => {
      this.connected = false;
      this.stopPingTimer();
      logger.warn(
        { code, reason: reason?.toString() },
        "Sports WS scores: disconnected",
      );
      if (this.running) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      logger.warn({ err }, "Sports WS scores: error");
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Skip non-game messages
    if (msg.type === "pong") return;

    const gameId = msg.gameId as number;
    if (!gameId) return;

    const leagueAbbreviation = (msg.leagueAbbreviation ?? "") as string;
    const homeTeam = (msg.homeTeam ?? "") as string;
    const awayTeam = (msg.awayTeam ?? "") as string;
    const scoreStr = (msg.score ?? "") as string;
    const period = (msg.period ?? null) as string | null;
    const status = (msg.status ?? "") as string;
    const ended = Boolean(msg.ended);

    // Parse "H-A" score string
    const { homeScore, awayScore } = this.parseScore(scoreStr);

    logger.debug(
      { gameId, leagueAbbreviation, homeTeam, awayTeam, score: scoreStr, period, status, ended },
      "Sports WS scores: game update",
    );

    // Update matching markets in DB
    this.updateMarketScores({
      gameId,
      leagueAbbreviation,
      homeTeam,
      awayTeam,
    }, homeScore, awayScore, period, status, ended);
  }

  private parseScore(scoreStr: string): { homeScore: number | null; awayScore: number | null } {
    if (!scoreStr || typeof scoreStr !== "string") return { homeScore: null, awayScore: null };

    const parts = scoreStr.split("-");
    if (parts.length !== 2) return { homeScore: null, awayScore: null };

    const h = parseInt(parts[0], 10);
    const a = parseInt(parts[1], 10);

    if (isNaN(h) || isNaN(a)) return { homeScore: null, awayScore: null };
    return { homeScore: h, awayScore: a };
  }

  private async updateMarketScores(
    identity: GameIdentity,
    homeScore: number | null,
    awayScore: number | null,
    period: string | null,
    status: string,
    ended: boolean,
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = {};
      if (homeScore !== null) updates.homeScore = homeScore;
      if (awayScore !== null) updates.awayScore = awayScore;
      if (period) updates.period = period;
      if (ended) updates.status = "settled";

      if (Object.keys(updates).length === 0) return;

      const rows = await db
        .update(sportPolyMarketsTable)
        .set(updates)
        .where(
          and(
            eq(sportPolyMarketsTable.homeTeam, identity.homeTeam),
            eq(sportPolyMarketsTable.awayTeam, identity.awayTeam),
            ilike(sportPolyMarketsTable.league, `%${identity.leagueAbbreviation}%`),
          ),
        )
        .returning({ id: sportPolyMarketsTable.id });

      if (rows.length > 0) {
        logger.info(
          {
            gameId: identity.gameId,
            marketsUpdated: rows.length,
            homeScore,
            awayScore,
            ended,
          },
          "Sports WS scores: markets updated",
        );
      }
    } catch (err) {
      logger.error({ err, gameId: identity.gameId }, "Sports WS scores: DB update failed");
    }
  }

  private startPingTimer(): void {
    this.stopPingTimer();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("pong");
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const delay = Math.min(
      RECONNECT_MIN_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    logger.info({ delay, attempt: this.reconnectAttempts }, "Sports WS scores: reconnecting");
    setTimeout(() => {
      if (this.running) this.connect();
    }, delay);
  }
}

// Singleton
const wsScores = new SportsWsScores();
export default wsScores;
