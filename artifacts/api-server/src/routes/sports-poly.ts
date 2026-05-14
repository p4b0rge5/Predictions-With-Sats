import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { bech32 } from "bech32";
import { db, sportPolyBetsTable, sportPolyMarketsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { createInvoice } from "../lib/alby";
import { coinosPayInvoice } from "../lib/coinos";
import { validateExactInvoiceAmount } from "../lib/lightning-invoice";
import { logger } from "../lib/logger";
import { getPublicBaseUrl } from "../lib/public-base-url";
import { deriveWithdrawK1 } from "../lib/withdraw-k1";
import { toLnurlWithdrawDescription } from "../lib/lnurl-withdraw";
import {
  addToSportsPolyPool,
  getOutcomeForSportsPolyMarket,
  listSportsPolyMarkets,
} from "../lib/sports-poly";
import {
  normalizeStoredLeague,
  normalizeStoredSport,
} from "../lib/polymarket-sports";
import { enrichSportsPolyPresentation } from "../lib/sports-poly-presentation";
import {
  fetchPolymarketGames,
  getPolymarketSports,
  getEventById,
  checkEventSettlement,
  getLeagueLabel,
  getLeagueLogo,
  normalizePolymarketSport,
} from "../lib/polymarket-games";

const router: IRouter = Router();

const MIN_AMOUNT_SATS = 250;
const PAYOUT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// In-memory cache for /sports-poly/markets response (5 min TTL).
// The enrich step calls ~50 Polymarket API endpoints on cache miss.
// Serving cached data keeps the page responsive between the periodic pollers.
const MARKETS_CACHE_TTL_MS = 5 * 60 * 1000;
let marketsCache: { data: unknown; expiresAt: number } | null = null;

function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500);
}

router.get("/sports-poly/markets", async (req, res): Promise<void> => {
  const { force } = req.query as { force?: string };
  const forceRefresh = force === "1" || force === "true";
  try {
    // Serve from cache if available (unless ?force=1)
    if (!forceRefresh && marketsCache && marketsCache.expiresAt > Date.now()) {
      res.json(marketsCache.data);
      return;
    }

    const markets = await listSportsPolyMarkets();
    const normalized = markets.map((market) => {
      const sport = normalizeStoredSport(
        market.sport,
        market.league,
        market.eventName,
        market.question,
        market.sourceUrl ?? null,
      );
      const leaguePresentation = normalizeStoredLeague(
        market.league,
        market.sourceUrl ?? null,
        sport,
      );

      return {
        id: market.id,
        provider: market.provider,
        eventName: market.eventName,
        homeTeam: market.homeTeam,
        awayTeam: market.awayTeam,
        homeTeamId: market.homeTeamId ?? null,
        awayTeamId: market.awayTeamId ?? null,
        homeBadge: null,
        awayBadge: null,
        leagueLogo: leaguePresentation.leagueLogo,
        league: leaguePresentation.league,
        sport,
        startsAt: market.startsAt,
        question: market.question,
        subtitle: market.subtitle ?? null,
        sourceUrl: market.sourceUrl ?? null,
        status: market.status,
        outcome: market.winningOutcome ?? null,
        resolvedValue: market.resolvedValue ?? null,
        settledAt: market.settledAt?.toISOString() ?? null,
        outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
      };
    });

    const presentation = await enrichSportsPolyPresentation(normalized);
    const enriched = normalized.map((market, index) => {
      const display = presentation[index];

      return {
        ...market,
        homeBadge: display.homeBadge,
        awayBadge: display.awayBadge,
        leagueLogo: display.leagueLogo,
        league: display.league,
        startsAt: display.startsAt.toISOString(),
      };
    });

    // Cache the result
    marketsCache = { data: enriched, expiresAt: Date.now() + MARKETS_CACHE_TTL_MS };

    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "GET /api/sports-poly/markets error");
    // Serve stale cache on error
    if (marketsCache) {
      logger.warn("Serving stale sports-poly/markets cache after error");
      res.json(marketsCache.data);
      return;
    }
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// List Polymarket sports leagues (available leagues)
// ---------------------------------------------------------------------------

router.get("/sports-poly/leagues", async (_req, res): Promise<void> => {
  try {
    const sports = await getPolymarketSports();
    const result = sports.map((s) => ({
      slug: s.sport,
      label: getLeagueLabel(s.sport),
      logo: s.image ?? getLeagueLogo(s.sport),
      seriesId: s.series,
      sport: normalizePolymarketSport(s.sport, s.sport),
    }));
    res.json(result);
  } catch (err) {
    logger.error({ err }, "GET /api/sports-poly/leagues error");
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// List games (match events) from Polymarket — for all leagues
// ---------------------------------------------------------------------------

router.get("/sports-poly/games", async (req, res): Promise<void> => {
  const { league, force } = req.query as { league?: string; force?: string };

  try {
    const result = await fetchPolymarketGames(force === "1" || force === "true");
    const games = result.events.map((g) => ({
      id: g.id,
      externalId: g.externalId,
      slug: g.slug,
      title: g.title,
      subtitle: g.subtitle,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeBadge: g.homeBadge,
      awayBadge: g.awayBadge,
      league: g.league,
      seriesSlug: g.seriesSlug,
      sportSlug: g.sportSlug,
      leagueLogo: getLeagueLogo(g.seriesSlug ?? g.league),
      sport: g.sport,
      startsAt: g.startsAt,
      endDate: g.endDate,
      status: g.status,
      closed: g.closed,
      winningOutcome: g.winningOutcome,
      resolvedValue: g.resolvedValue,
      settledAt: g.settledAt,
      sourceUrl: g.sourceUrl,
      resolutionSource: g.resolutionSource,
      volume: g.volume,
      openInterest: g.openInterest,
      marketCount: g.markets.length,
    }));

    // Filter by league if specified (match on sportSlug like "epl", "bra2", etc.)
    const filtered = league
      ? games.filter((g) =>
          (g.sportSlug && g.sportSlug.toLowerCase() === league.toLowerCase()) ||
          (g.seriesSlug && g.seriesSlug.toLowerCase() === league.toLowerCase()) ||
          (g.league && g.league.toLowerCase() === league.toLowerCase()),
        )
      : games;

    const settledFiltered = league
      ? result.settled.filter((g) =>
          (g.sportSlug && g.sportSlug.toLowerCase() === league.toLowerCase()) ||
          (g.seriesSlug && g.seriesSlug.toLowerCase() === league.toLowerCase()) ||
          (g.league && g.league.toLowerCase() === league.toLowerCase()),
        )
      : result.settled;

    res.json({
      games: filtered,
      settled: settledFiltered.map((g) => ({
        id: g.id,
        title: g.title,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeBadge: g.homeBadge,
        awayBadge: g.awayBadge,
        league: g.league,
        sportSlug: g.sportSlug,
        status: g.status,
        winningOutcome: g.winningOutcome,
        resolvedValue: g.resolvedValue,
        settledAt: g.settledAt,
      })),
      leagueCount: result.leagueCount,
      suspended: result.suspended,
    });
  } catch (err) {
    logger.error({ err }, "GET /api/sports-poly/games error");
    res.json({ games: [], settled: [], leagueCount: 0, suspended: true });
  }
});

// ---------------------------------------------------------------------------
// Get single game by external event ID
// ---------------------------------------------------------------------------

router.get("/sports-poly/games/:eventId", async (req, res): Promise<void> => {
  const { eventId } = req.params;

  try {
    const event = await getEventById(eventId);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json({
      id: event.id,
      externalId: event.externalId,
      slug: event.slug,
      title: event.title,
      subtitle: event.subtitle,
      description: event.description,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      homeBadge: event.homeBadge,
      awayBadge: event.awayBadge,
      league: getLeagueLabel(event.seriesSlug ?? event.league),
      leagueLogo: getLeagueLogo(event.seriesSlug ?? event.league),
      sport: event.sport,
      startsAt: event.startsAt,
      endDate: event.endDate,
      status: event.status,
      closed: event.closed,
      winningOutcome: event.winningOutcome,
      resolvedValue: event.resolvedValue,
      settledAt: event.settledAt,
      teams: event.teams,
      markets: event.markets.map((m) => ({
        id: m.id,
        question: m.question,
        slug: m.slug,
        outcomes: m.outcomes,
        outcomePrices: m.outcomePrices,
        volume: m.volume,
        liquidity: m.liquidity,
      })),
      sourceUrl: event.sourceUrl,
      resolutionSource: event.resolutionSource,
      volume: event.volume,
      openInterest: event.openInterest,
    });
  } catch (err) {
    logger.error({ err, eventId }, "GET /api/sports-poly/games/:eventId error");
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// ---------------------------------------------------------------------------
// Check settlement status for a game
// ---------------------------------------------------------------------------

router.get("/sports-poly/games/:eventId/settlement", async (req, res): Promise<void> => {
  const { eventId } = req.params;

  try {
    const result = await checkEventSettlement(eventId);
    if (!result) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err, eventId }, "GET /api/sports-poly/games/:eventId/settlement error");
    res.status(500).json({ error: "Failed to check settlement" });
  }
});

router.post("/sports-poly/bets", async (req, res): Promise<void> => {
  const { marketId, outcomeKey, amountSats } = req.body as {
    marketId?: number;
    outcomeKey?: string;
    amountSats?: number;
  };

  if (!marketId || !outcomeKey || !amountSats) {
    res.status(400).json({ error: "marketId, outcomeKey, and amountSats are required" });
    return;
  }

  if (!Number.isInteger(amountSats) || amountSats < MIN_AMOUNT_SATS) {
    res.status(400).json({ error: `Minimum bet is ${MIN_AMOUNT_SATS} sats` });
    return;
  }

  const [market] = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(and(eq(sportPolyMarketsTable.id, marketId), eq(sportPolyMarketsTable.status, "open")))
    .limit(1);

  if (!market) {
    res.status(404).json({ error: "Sports Poly market not found or not open" });
    return;
  }

  const outcome = getOutcomeForSportsPolyMarket(market, outcomeKey);
  if (!outcome) {
    res.status(400).json({ error: "Selected outcome is not valid for this market" });
    return;
  }

  try {
    const invoice = await createInvoice(
      amountSats,
      `Sports Poly: ${market.eventName} (${outcome.label})`,
    );

    const [bet] = await db
      .insert(sportPolyBetsTable)
      .values({
        marketId,
        direction: outcomeKey,
        outcomeLabel: outcome.label,
        amountSats,
        paymentHash: invoice.paymentHash,
        paymentRequest: invoice.paymentRequest,
        verifyUrl: invoice.verifyUrl ?? null,
        status: "pending",
      })
      .returning();

    res.json({
      betId: bet.id,
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.paymentRequest,
      verifyUrl: invoice.verifyUrl ?? null,
      amountSats,
    });
  } catch (err) {
    logger.error({ err }, "POST /api/sports-poly/bets error");
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

router.get("/sports-poly/bets/:hash", async (req, res): Promise<void> => {
  const { hash } = req.params;

  const [bet] = await db
    .select()
    .from(sportPolyBetsTable)
    .where(eq(sportPolyBetsTable.paymentHash, hash))
    .limit(1);

  if (!bet) {
    res.status(404).json({ error: "Bet not found" });
    return;
  }

  const [market] = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(eq(sportPolyMarketsTable.id, bet.marketId))
    .limit(1);

  const publicBase = getPublicBaseUrl(req);
  const withdrawLnurl =
    bet.status === "won" && bet.withdrawToken && bet.withdrawStatus === "unclaimed"
      ? encodeLnurl(`${publicBase}/api/sports-poly/withdraw/${bet.withdrawToken}`)
      : null;

  res.json({
    id: bet.id,
    paymentHash: bet.paymentHash,
    direction: bet.direction,
    outcomeLabel: bet.outcomeLabel ?? null,
    amountSats: bet.amountSats,
    status: bet.status,
    payoutSats: bet.payoutSats ?? null,
    withdrawToken: bet.withdrawToken ?? null,
    withdrawLnurl,
    withdrawStatus: bet.withdrawStatus ?? null,
    createdAt: bet.createdAt.toISOString(),
    paidAt: bet.paidAt?.toISOString() ?? null,
    market: market
      ? await (async () => {
          const sport = normalizeStoredSport(
            market.sport,
            market.league,
            market.eventName,
            market.question,
            market.sourceUrl ?? null,
          );
          const leaguePresentation = normalizeStoredLeague(
            market.league,
            market.sourceUrl ?? null,
            sport,
          );

          const [display] = await enrichSportsPolyPresentation([{
            eventName: market.eventName,
            homeTeam: market.homeTeam,
            awayTeam: market.awayTeam,
            homeTeamId: market.homeTeamId ?? null,
            awayTeamId: market.awayTeamId ?? null,
            homeBadge: null,
            awayBadge: null,
            leagueLogo: leaguePresentation.leagueLogo,
            league: leaguePresentation.league,
            sport,
            startsAt: market.startsAt,
            sourceUrl: market.sourceUrl ?? null,
          }]);

          return {
            provider: market.provider,
            eventName: market.eventName,
            homeTeam: market.homeTeam,
            awayTeam: market.awayTeam,
            homeBadge: display.homeBadge,
            awayBadge: display.awayBadge,
            leagueLogo: display.leagueLogo,
            league: display.league,
            sport,
            startsAt: display.startsAt.toISOString(),
            question: market.question,
            subtitle: market.subtitle ?? null,
            sourceUrl: market.sourceUrl ?? null,
            status: market.status,
            outcome: market.winningOutcome ?? null,
            resolvedValue: market.resolvedValue ?? null,
            outcomes: Array.isArray(market.outcomes) ? market.outcomes : [],
          };
        })()
      : null,
  });
});

router.post("/sports-poly/bets/:hash/verify", async (req, res): Promise<void> => {
  const { hash } = req.params;
  const rawPreimage = req.body?.preimage;

  if (typeof rawPreimage !== "string" || rawPreimage.trim().length === 0) {
    res.status(400).json({ error: "preimage field is required" });
    return;
  }

  const preimage = rawPreimage.trim().toLowerCase();
  const computedHash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
  if (computedHash !== hash.toLowerCase()) {
    res.status(400).json({ error: "Invalid preimage for this payment hash" });
    return;
  }

  const [bet] = await db
    .update(sportPolyBetsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(sportPolyBetsTable.paymentHash, hash), eq(sportPolyBetsTable.status, "pending")))
    .returning();

  if (!bet) {
    res.status(404).json({ error: "Bet not found or already confirmed" });
    return;
  }

  try {
    await addToSportsPolyPool(bet.marketId, bet.direction, bet.amountSats);
  } catch (err) {
    logger.warn({ err, sportPolyBetId: bet.id }, "Failed to update Sports Poly outcome pool after preimage verify");
  }

  res.json({ ok: true });
});

router.get("/sports-poly/withdraw/:token", async (req, res): Promise<void> => {
  const { token } = req.params;
  const publicBase = getPublicBaseUrl(req);

  const [bet] = await db
    .select()
    .from(sportPolyBetsTable)
    .where(eq(sportPolyBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || bet.status !== "won" || !bet.payoutSats) {
    res.status(404).json({ status: "ERROR", reason: "Payout not found or not claimable" });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.status(410).json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  const createdAt = bet.paidAt ?? bet.createdAt;
  if (Date.now() - createdAt.getTime() > PAYOUT_EXPIRY_MS) {
    res.status(410).json({ status: "ERROR", reason: "Payout expired" });
    return;
  }

  const callbackUrl = `${publicBase}/api/sports-poly/withdraw/${token}/callback`;

  const [market] = await db
    .select()
    .from(sportPolyMarketsTable)
    .where(eq(sportPolyMarketsTable.id, bet.marketId))
    .limit(1);

  const eventName = market?.eventName ?? market?.question ?? "Sports Poly Market";
  const pickLabel = bet.outcomeLabel ?? bet.direction;

  res.json({
    tag: "withdrawRequest",
    callback: callbackUrl,
    k1: deriveWithdrawK1(token),
    defaultDescription: toLnurlWithdrawDescription(`PWSats win ${pickLabel} ${eventName} Sports Poly`),
    minWithdrawable: bet.payoutSats * 1000,
    maxWithdrawable: bet.payoutSats * 1000,
  });
});

router.get("/sports-poly/withdraw/:token/callback", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { k1, pr } = req.query as { k1?: string; pr?: string };

  if (!k1 || !pr) {
    res.json({ status: "ERROR", reason: "Missing k1 or pr parameter" });
    return;
  }

  if (k1 !== deriveWithdrawK1(token)) {
    res.json({ status: "ERROR", reason: "Invalid k1 parameter" });
    return;
  }

  const [bet] = await db
    .select()
    .from(sportPolyBetsTable)
    .where(eq(sportPolyBetsTable.withdrawToken, token))
    .limit(1);

  if (!bet || bet.status !== "won") {
    res.json({ status: "ERROR", reason: "Payout not found or not claimable" });
    return;
  }

  if (bet.withdrawStatus === "claimed") {
    res.json({ status: "ERROR", reason: "Already claimed" });
    return;
  }

  if (bet.payoutSats === null) {
    res.json({ status: "ERROR", reason: "Payout amount not available" });
    return;
  }

  try {
    validateExactInvoiceAmount(pr, bet.payoutSats);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Invalid withdrawal invoice";
    res.json({ status: "ERROR", reason });
    return;
  }

  try {
    const [claimed] = await db
      .update(sportPolyBetsTable)
      .set({ withdrawStatus: "claimed", claimedAt: new Date() })
      .where(and(eq(sportPolyBetsTable.id, bet.id), eq(sportPolyBetsTable.withdrawStatus, "unclaimed")))
      .returning();

    if (!claimed) {
      res.json({ status: "ERROR", reason: "Already claimed" });
      return;
    }

    await coinosPayInvoice(pr, bet.payoutSats);

    res.json({ status: "OK" });
    logger.info({ betId: bet.id, token }, "Sports Poly payout claimed");
  } catch (err) {
    await db
      .update(sportPolyBetsTable)
      .set({ withdrawStatus: "unclaimed", claimedAt: null })
      .where(eq(sportPolyBetsTable.id, bet.id));
    logger.error({ err, betId: bet.id }, "Sports Poly payout failed");
    res.json({ status: "ERROR", reason: "Payment failed" });
  }
});

router.post("/sports-poly/withdraw/:token/pay-to-address", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { address } = req.body as { address?: string };

  if (!address || !address.includes("@") || address.split("@").length !== 2) {
    res.status(400).json({ error: "Invalid Lightning address format." });
    return;
  }

  const [bet] = await db
    .select()
    .from(sportPolyBetsTable)
    .where(and(eq(sportPolyBetsTable.withdrawToken, token), eq(sportPolyBetsTable.withdrawStatus, "unclaimed")))
    .limit(1);

  if (!bet) { res.status(404).json({ error: "Withdraw token not found or already claimed." }); return; }
  if (bet.status !== "won" || !bet.payoutSats) { res.status(409).json({ error: "Bet not eligible for withdrawal." }); return; }

  const [user, domain] = address.split("@");
  let callbackUrl: string, minSendable: number, maxSendable: number;
  try {
    const metaRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`, { signal: AbortSignal.timeout(10_000) });
    if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
    const meta = await metaRes.json() as { callback: string; minSendable: number; maxSendable: number; tag: string };
    if (meta.tag !== "payRequest") throw new Error("Not a LNURL-Pay endpoint");
    callbackUrl = meta.callback; minSendable = meta.minSendable; maxSendable = meta.maxSendable;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Could not reach wallet at ${domain}: ${msg}` }); return;
  }

  const amountMsats = bet.payoutSats * 1000;
  if (amountMsats < minSendable || amountMsats > maxSendable) {
    res.status(400).json({ error: `Payout of ${bet.payoutSats} sats is outside the wallet's accepted range.` }); return;
  }

  let bolt11: string;
  try {
    const invoiceUrl = new URL(callbackUrl);
    invoiceUrl.searchParams.set("amount", String(amountMsats));
    const invRes = await fetch(invoiceUrl, { signal: AbortSignal.timeout(10_000) });
    if (!invRes.ok) throw new Error(`HTTP ${invRes.status}`);
    const inv = await invRes.json() as { pr?: string; reason?: string };
    if (!inv.pr) throw new Error(inv.reason ?? "No invoice in response");
    validateExactInvoiceAmount(inv.pr, bet.payoutSats);
    bolt11 = inv.pr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Could not get invoice from wallet: ${msg}` }); return;
  }

  const [updated] = await db
    .update(sportPolyBetsTable)
    .set({ withdrawStatus: "claimed", claimedAt: new Date() })
    .where(and(eq(sportPolyBetsTable.withdrawToken, token), eq(sportPolyBetsTable.withdrawStatus, "unclaimed")))
    .returning();

  if (!updated) { res.status(409).json({ error: "Payout already claimed." }); return; }

  try {
    await coinosPayInvoice(bolt11, bet.payoutSats);
    logger.info({ betId: bet.id, payoutSats: bet.payoutSats, address }, "Sports Poly payout sent to Lightning address");
    res.json({ ok: true });
  } catch (err) {
    await db.update(sportPolyBetsTable).set({ withdrawStatus: "unclaimed", claimedAt: null }).where(eq(sportPolyBetsTable.id, bet.id));
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, betId: bet.id }, "Sports Poly pay-to-address failed");
    res.status(502).json({ error: `Payment failed: ${msg}` });
  }
});

export default router;
