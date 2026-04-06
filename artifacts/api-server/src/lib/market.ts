import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { db, marketWindowsTable, betsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { fetchAndStoreBtcPrice, fetchPricesRaw, storePriceSnapshots } from "./price";
import { logger } from "./logger";

const WINDOW_DURATION_MS = 5 * 60 * 1000;
const SETTLEMENT_BUFFER_MS = 30 * 1000;

export function getWindowClosesAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + WINDOW_DURATION_MS);
}

export async function getLatestWindow() {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

export async function getActiveWindow() {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.status, "open"))
    .orderBy(desc(marketWindowsTable.id))
    .limit(1);
  return win ?? null;
}

async function createNewWindow(): Promise<void> {
  logger.info("Creating new market window");
  const { sources, price: openPrice } = await fetchPricesRaw();
  const [win] = await db
    .insert(marketWindowsTable)
    .values({ openPrice: openPrice.toFixed(2), status: "open" })
    .returning();
  await storePriceSnapshots(win.id, false, sources);
  logger.info({ windowId: win.id, openPrice }, "Market window opened");
}

async function closeWindow(windowId: number): Promise<void> {
  const result = await db
    .update(marketWindowsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "open")))
    .returning();
  if (result.length > 0) {
    logger.info({ windowId }, "Market window closed");
  }
}

async function settleWindow(windowId: number): Promise<void> {
  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "closed")))
    .limit(1);

  if (!win) {
    logger.warn({ windowId }, "Window not found or not in closed state — skipping settlement");
    return;
  }

  logger.info({ windowId }, "Settling market window");

  const closePrice = await fetchAndStoreBtcPrice(windowId, true);
  const openPriceNum = parseFloat(win.openPrice ?? "0");

  let outcome: "up" | "down" | "draw";
  if (closePrice > openPriceNum) {
    outcome = "up";
  } else if (closePrice < openPriceNum) {
    outcome = "down";
  } else {
    outcome = "draw";
  }

  const paidBets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));

  const totalPool = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
  const payablePool = Math.floor(totalPool * 0.99);
  const winners = outcome === "draw" ? paidBets : paidBets.filter(b => b.direction === outcome);
  const totalWinnerStake = winners.reduce((sum, b) => sum + b.amountSats, 0);

  for (const bet of paidBets) {
    const isWinner = outcome === "draw" || bet.direction === outcome;
    let payoutSats: number | null = null;
    if (isWinner) {
      payoutSats =
        totalWinnerStake > 0
          ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
          : bet.amountSats;
    }
    await db
      .update(betsTable)
      .set({
        status: isWinner ? "won" : "lost",
        payoutSats,
        // Generate a unique withdraw token for winners so they can claim via LNURL-Withdraw
        ...(isWinner ? { withdrawToken: randomUUID(), withdrawStatus: "unclaimed" } : {}),
      })
      .where(eq(betsTable.id, bet.id));
  }

  await db
    .update(betsTable)
    .set({ status: "expired" })
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "pending")));

  await db
    .update(marketWindowsTable)
    .set({
      closePrice: closePrice.toFixed(2),
      outcome,
      status: "settled",
      settledAt: new Date(),
    })
    .where(and(eq(marketWindowsTable.id, windowId), eq(marketWindowsTable.status, "closed")));

  logger.info(
    { windowId, outcome, openPrice: openPriceNum, closePrice, totalPool },
    "Window settled",
  );
}

let cycleRunning = false;

async function runMarketCycle(): Promise<void> {
  if (cycleRunning) {
    logger.debug("Market cycle already running — skipping");
    return;
  }
  cycleRunning = true;
  try {
    const win = await getLatestWindow();

    if (!win || win.status === "settled") {
      await createNewWindow();
      return;
    }

    if (win.status === "open") {
      const closesAt = getWindowClosesAt(win.openedAt);
      if (Date.now() >= closesAt.getTime()) {
        await closeWindow(win.id);
      }
      return;
    }

    if (win.status === "closed" && win.closedAt) {
      const settleAt = new Date(win.closedAt.getTime() + SETTLEMENT_BUFFER_MS);
      if (Date.now() >= settleAt.getTime()) {
        await settleWindow(win.id);
        await createNewWindow();
      }
      return;
    }
  } catch (err) {
    logger.error({ err }, "Market cycle error");
  } finally {
    cycleRunning = false;
  }
}

let engineStarted = false;

export function startMarketEngine(): void {
  if (engineStarted) return;
  engineStarted = true;

  logger.info("Market engine starting");

  runMarketCycle().catch(err =>
    logger.error({ err }, "Initial market cycle failed"),
  );

  cron.schedule("*/10 * * * * *", () => {
    runMarketCycle().catch(err =>
      logger.error({ err }, "Scheduled market cycle error"),
    );
  });
}

export async function getWindowBetTotals(windowId: number): Promise<{ totalUpSats: number; totalDownSats: number }> {
  const bets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));
  const totalUpSats = bets.filter(b => b.direction === "up").reduce((s, b) => s + b.amountSats, 0);
  const totalDownSats = bets.filter(b => b.direction === "down").reduce((s, b) => s + b.amountSats, 0);
  return { totalUpSats, totalDownSats };
}

export async function getSettledWindows(limit: number) {
  return db
    .select()
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.status, "settled"))
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
