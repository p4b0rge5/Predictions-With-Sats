import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { db, marketWindowsTable, betsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { fetchPricesRaw, fetchAndStorePrice, storePriceSnapshots, type CryptoAsset } from "./price";
import { logger } from "./logger";

// ── Constants ──────────────────────────────────────────────────────────────────

export const SUPPORTED_INTERVALS = [5, 15, 30] as const;
export type IntervalMinutes = typeof SUPPORTED_INTERVALS[number];

const PLATFORM_FEE = 0.02;
const NO_LIQUIDITY_REFUND_FEE = 0.005;

export const SUPPORTED_ASSETS: CryptoAsset[] = ["btc", "eth", "sol", "xrp", "bnb"];

// ── Epoch helpers (interval-aware) ────────────────────────────────────────────

function epochIndexOf(timestampMs: number, intervalMs: number): number {
  return Math.floor(timestampMs / intervalMs);
}

function epochStartOf(timestampMs: number, intervalMs: number): Date {
  return new Date(epochIndexOf(timestampMs, intervalMs) * intervalMs);
}

export function getWindowClosesAt(openedAt: Date, intervalMinutes: number = 5): Date {
  return new Date(openedAt.getTime() + intervalMinutes * 60 * 1000);
}

// ── DB helpers (asset + interval scoped) ──────────────────────────────────────

export async function getLatestWindow(asset: CryptoAsset = "btc", intervalMinutes: number = 5) {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(and(
      eq(marketWindowsTable.asset, asset),
      eq(marketWindowsTable.intervalMinutes, intervalMinutes),
    ))
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

export async function getActiveWindow(asset: CryptoAsset = "btc", intervalMinutes: number = 5) {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(and(
      eq(marketWindowsTable.asset, asset),
      eq(marketWindowsTable.status, "open"),
      eq(marketWindowsTable.intervalMinutes, intervalMinutes),
    ))
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

// ── Window lifecycle ───────────────────────────────────────────────────────────

async function createNewWindow(openedAt: Date, asset: CryptoAsset, intervalMinutes: number): Promise<void> {
  logger.info({ asset, intervalMinutes }, "Creating new market window");
  const { sources, price: openPrice } = await fetchPricesRaw(asset);
  const [win] = await db
    .insert(marketWindowsTable)
    .values({ asset, openedAt, openPrice: openPrice.toFixed(2), status: "open", intervalMinutes })
    .returning();
  await storePriceSnapshots(win.id, false, sources);
  logger.info({ windowId: win.id, asset, openPrice, openedAt, intervalMinutes }, "Market window opened");
}

async function closeWindow(windowId: number, asset: CryptoAsset): Promise<void> {
  const result = await db
    .update(marketWindowsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "open")))
    .returning();
  if (result.length > 0) {
    logger.info({ windowId, asset }, "Market window closed");
  }
}

async function settleWindow(windowId: number, asset: CryptoAsset): Promise<void> {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "closed")))
    .limit(1);

  if (!win) {
    logger.warn({ windowId, asset }, "Window not found or not closed — skipping");
    return;
  }

  logger.info({ windowId, asset }, "Settling market window");

  const closePrice = await fetchAndStorePrice(windowId, true, asset);
  const closePriceStr = closePrice.toFixed(2);
  const openPriceStr = win.openPrice ?? "0";

  const paidBets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));

  const upBets = paidBets.filter((b) => b.direction === "up");
  const downBets = paidBets.filter((b) => b.direction === "down");

  const hasNoLiquidity =
    paidBets.length > 0 && (upBets.length === 0 || downBets.length === 0);

  let outcome: "up" | "down" | "draw" | "no_liquidity";

  if (hasNoLiquidity) {
    outcome = "no_liquidity";
    for (const bet of paidBets) {
      const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
      await db
        .update(betsTable)
        .set({ status: "won", payoutSats: refundSats, withdrawToken: randomUUID(), withdrawStatus: "unclaimed" })
        .where(eq(betsTable.id, bet.id));
    }
    logger.info(
      { windowId, asset, refundedBets: paidBets.length, refundFeeRate: NO_LIQUIDITY_REFUND_FEE },
      "No-liquidity — refund prepared with reduced fee",
    );
  } else if (closePriceStr === openPriceStr) {
    outcome = "draw";
    for (const bet of paidBets) {
      const refundSats = Math.floor(bet.amountSats * (1 - NO_LIQUIDITY_REFUND_FEE));
      await db
        .update(betsTable)
        .set({ status: "won", payoutSats: refundSats, withdrawToken: randomUUID(), withdrawStatus: "unclaimed" })
        .where(eq(betsTable.id, bet.id));
    }
    logger.info(
      { windowId, asset, openPrice: openPriceStr, closePrice: closePriceStr, refundedBets: paidBets.length },
      "Draw — all bets refunded with reduced fee",
    );
  } else {
    outcome = parseFloat(closePriceStr) > parseFloat(openPriceStr) ? "up" : "down";

    const totalPool = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
    const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE));
    const winners = paidBets.filter((b) => b.direction === outcome);
    const totalWinnerStake = winners.reduce((sum, b) => sum + b.amountSats, 0);

    for (const bet of paidBets) {
      const isWinner = bet.direction === outcome;
      const payoutSats = isWinner
        ? totalWinnerStake > 0
          ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
          : bet.amountSats
        : null;
      await db
        .update(betsTable)
        .set({
          status: isWinner ? "won" : "lost",
          payoutSats,
          ...(isWinner ? { withdrawToken: randomUUID(), withdrawStatus: "unclaimed" } : {}),
        })
        .where(eq(betsTable.id, bet.id));
    }
    logger.info({ windowId, asset, outcome, openPrice: openPriceStr, closePrice: closePriceStr }, "Window settled");
  }

  await db
    .update(betsTable)
    .set({ status: "expired" })
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "pending")));

  await db
    .update(marketWindowsTable)
    .set({ closePrice: closePriceStr, outcome, status: "settled", settledAt: new Date() })
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "closed")));
}

// ── Market cycle (per-asset per-interval) ─────────────────────────────────────

const cycleRunning: Record<string, boolean> = {};

async function runMarketCycle(asset: CryptoAsset, intervalMinutes: number): Promise<void> {
  const key = `${asset}-${intervalMinutes}`;
  if (cycleRunning[key]) return;
  cycleRunning[key] = true;
  try {
    const now = Date.now();
    const intervalMs = intervalMinutes * 60 * 1000;
    const currentEpochStart = epochStartOf(now, intervalMs);
    const currentEpochIdx = epochIndexOf(now, intervalMs);
    const latest = await getLatestWindow(asset, intervalMinutes);

    if (!latest) {
      await createNewWindow(currentEpochStart, asset, intervalMinutes);
      return;
    }

    const latestEpochIdx = epochIndexOf(latest.openedAt.getTime(), intervalMs);

    if (latest.status === "settled" && latestEpochIdx < currentEpochIdx) {
      await createNewWindow(currentEpochStart, asset, intervalMinutes);
      return;
    }

    if (latest.status === "open") {
      const closesAt = getWindowClosesAt(latest.openedAt, intervalMinutes);
      if (now >= closesAt.getTime()) await closeWindow(latest.id, asset);
      return;
    }

    if (latest.status === "closed" && latest.closedAt) {
      // Wait for a grace period after close so in-flight payment confirmations
      // (Alby webhook, LUD-21 polling, preimage verify) can reach the DB before
      // we query paid bets — prevents a false no_liquidity / REFUND outcome.
      const SETTLEMENT_GRACE_MS = 30_000;
      if (Date.now() - latest.closedAt.getTime() < SETTLEMENT_GRACE_MS) return;
      await settleWindow(latest.id, asset);
      await createNewWindow(currentEpochStart, asset, intervalMinutes);
      return;
    }
  } catch (err) {
    logger.error({ err, asset, intervalMinutes }, "Market cycle error");
  } finally {
    cycleRunning[key] = false;
  }
}

// ── Engine bootstrap ────────────────────────────────────────────────────────────

let engineStarted = false;

export function startMarketEngine(): void {
  if (engineStarted) return;
  engineStarted = true;
  logger.info("Market engine starting (btc, eth, sol — 5m & 15m)");

  for (const asset of SUPPORTED_ASSETS) {
    for (const interval of SUPPORTED_INTERVALS) {
      runMarketCycle(asset, interval).catch((err) =>
        logger.error({ err, asset, interval }, "Initial market cycle failed"),
      );
    }
  }

  cron.schedule("*/10 * * * * *", () => {
    for (const asset of SUPPORTED_ASSETS) {
      for (const interval of SUPPORTED_INTERVALS) {
        runMarketCycle(asset, interval).catch((err) =>
          logger.error({ err, asset, interval }, "Scheduled market cycle error"),
        );
      }
    }
  });
}

// ── Public query helpers ────────────────────────────────────────────────────────

export async function getWindowBetTotals(windowId: number) {
  const bets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));
  const totalUpSats = bets.filter((b) => b.direction === "up").reduce((s, b) => s + b.amountSats, 0);
  const totalDownSats = bets.filter((b) => b.direction === "down").reduce((s, b) => s + b.amountSats, 0);
  return { totalUpSats, totalDownSats };
}

export async function getSettledWindows(limit: number, asset: CryptoAsset = "btc", intervalMinutes: number = 5) {
  return db
    .select()
    .from(marketWindowsTable)
    .where(and(
      eq(marketWindowsTable.status, "settled"),
      eq(marketWindowsTable.asset, asset),
      eq(marketWindowsTable.intervalMinutes, intervalMinutes),
    ))
    .orderBy(desc(marketWindowsTable.id))
    .limit(limit);
}

export async function getPlatformStats() {
  const [windowStats] = await db
    .select({
      totalSettled: db.$count(marketWindowsTable, eq(marketWindowsTable.status, "settled")),
    })
    .from(marketWindowsTable);

  const upWinCount = await db.$count(
    marketWindowsTable,
    and(eq(marketWindowsTable.status, "settled"), eq(marketWindowsTable.outcome, "up")),
  );

  const paidBets = await db
    .select()
    .from(betsTable)
    .where(and(ne(betsTable.status, "pending"), ne(betsTable.status, "expired")));

  const totalBets = paidBets.length;
  const totalVolumeSats = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
  const totalSettled = Number(windowStats?.totalSettled ?? 0);
  const upWinRate = totalSettled > 0 ? upWinCount / totalSettled : 0;

  return { totalBets, totalVolumeSats, totalWindowsSettled: totalSettled, upWinRate };
}
