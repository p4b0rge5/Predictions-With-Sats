import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { db, marketWindowsTable, betsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { fetchPricesRaw, fetchAndStorePrice, storePriceSnapshots, type CryptoAsset } from "./price";
import { logger } from "./logger";

// ── Constants ──────────────────────────────────────────────────────────────────

const WINDOW_DURATION_MS = 5 * 60 * 1000;
const PLATFORM_FEE = 0.02;

export const SUPPORTED_ASSETS: CryptoAsset[] = ["btc", "eth", "sol"];

// ── Epoch helpers ──────────────────────────────────────────────────────────────

function epochIndexOf(timestampMs: number): number {
  return Math.floor(timestampMs / WINDOW_DURATION_MS);
}

function epochStartOf(timestampMs: number): Date {
  return new Date(epochIndexOf(timestampMs) * WINDOW_DURATION_MS);
}

export function getWindowClosesAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + WINDOW_DURATION_MS);
}

// ── DB helpers (asset-scoped) ──────────────────────────────────────────────────

export async function getLatestWindow(asset: CryptoAsset = "btc") {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.asset, asset))
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

export async function getActiveWindow(asset: CryptoAsset = "btc") {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(and(eq(marketWindowsTable.asset, asset), eq(marketWindowsTable.status, "open")))
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

// ── Window lifecycle ───────────────────────────────────────────────────────────

async function createNewWindow(openedAt: Date, asset: CryptoAsset): Promise<void> {
  logger.info({ asset }, "Creating new market window");
  const { sources, price: openPrice } = await fetchPricesRaw(asset);
  const [win] = await db
    .insert(marketWindowsTable)
    .values({ asset, openedAt, openPrice: openPrice.toFixed(2), status: "open" })
    .returning();
  await storePriceSnapshots(win.id, false, sources);
  logger.info({ windowId: win.id, asset, openPrice, openedAt }, "Market window opened");
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
  const openPriceNum = parseFloat(win.openPrice ?? "0");

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
      const refundSats = Math.floor(bet.amountSats * (1 - PLATFORM_FEE));
      await db
        .update(betsTable)
        .set({ status: "won", payoutSats: refundSats, withdrawToken: randomUUID(), withdrawStatus: "unclaimed" })
        .where(eq(betsTable.id, bet.id));
    }
    logger.info({ windowId, asset, refundedBets: paidBets.length }, "No-liquidity — refunded");
  } else {
    if (closePrice > openPriceNum) outcome = "up";
    else if (closePrice < openPriceNum) outcome = "down";
    else outcome = "draw";

    const totalPool = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
    const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE));
    const winners = outcome === "draw" ? paidBets : paidBets.filter((b) => b.direction === outcome);
    const totalWinnerStake = winners.reduce((sum, b) => sum + b.amountSats, 0);

    for (const bet of paidBets) {
      const isWinner = outcome === "draw" || bet.direction === outcome;
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
    logger.info({ windowId, asset, outcome, openPrice: openPriceNum, closePrice }, "Window settled");
  }

  await db
    .update(betsTable)
    .set({ status: "expired" })
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "pending")));

  await db
    .update(marketWindowsTable)
    .set({ closePrice: closePrice.toFixed(2), outcome, status: "settled", settledAt: new Date() })
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "closed")));
}

// ── Market cycle (per-asset) ────────────────────────────────────────────────────

const cycleRunning: Record<CryptoAsset, boolean> = { btc: false, eth: false, sol: false };

async function runMarketCycle(asset: CryptoAsset): Promise<void> {
  if (cycleRunning[asset]) return;
  cycleRunning[asset] = true;
  try {
    const now = Date.now();
    const currentEpochStart = epochStartOf(now);
    const currentEpochIdx = epochIndexOf(now);
    const latest = await getLatestWindow(asset);

    if (!latest) {
      await createNewWindow(currentEpochStart, asset);
      return;
    }

    const latestEpochIdx = epochIndexOf(latest.openedAt.getTime());

    if (latest.status === "settled" && latestEpochIdx < currentEpochIdx) {
      await createNewWindow(currentEpochStart, asset);
      return;
    }

    if (latest.status === "open") {
      const closesAt = getWindowClosesAt(latest.openedAt);
      if (now >= closesAt.getTime()) await closeWindow(latest.id, asset);
      return;
    }

    if (latest.status === "closed" && latest.closedAt) {
      await settleWindow(latest.id, asset);
      await createNewWindow(currentEpochStart, asset);
      return;
    }
  } catch (err) {
    logger.error({ err, asset }, "Market cycle error");
  } finally {
    cycleRunning[asset] = false;
  }
}

// ── Engine bootstrap ────────────────────────────────────────────────────────────

let engineStarted = false;

export function startMarketEngine(): void {
  if (engineStarted) return;
  engineStarted = true;
  logger.info("Market engine starting (btc, eth, sol)");

  for (const asset of SUPPORTED_ASSETS) {
    runMarketCycle(asset).catch((err) =>
      logger.error({ err, asset }, "Initial market cycle failed"),
    );
  }

  cron.schedule("*/10 * * * * *", () => {
    for (const asset of SUPPORTED_ASSETS) {
      runMarketCycle(asset).catch((err) =>
        logger.error({ err, asset }, "Scheduled market cycle error"),
      );
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

export async function getSettledWindows(limit: number, asset: CryptoAsset = "btc") {
  return db
    .select()
    .from(marketWindowsTable)
    .where(and(eq(marketWindowsTable.status, "settled"), eq(marketWindowsTable.asset, asset)))
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
