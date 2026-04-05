import { db, marketWindowsTable, betsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { fetchAndStoreBtcPrice } from "./price";
import { logger } from "./logger";

const WINDOW_DURATION_MS = 5 * 60 * 1000;
const SETTLEMENT_BUFFER_MS = 30 * 1000;
const WATCHDOG_INTERVAL_MS = 5_000;

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
  const openPrice = await fetchAndStoreBtcPrice(null, false);
  const [win] = await db
    .insert(marketWindowsTable)
    .values({ openPrice: openPrice.toFixed(2), status: "open" })
    .returning();
  logger.info({ windowId: win.id, openPrice }, "Market window opened");
}

async function closeWindow(windowId: number): Promise<void> {
  logger.info({ windowId }, "Closing market window");
  await db
    .update(marketWindowsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(marketWindowsTable.id, windowId));
}

async function settleWindow(windowId: number): Promise<void> {
  logger.info({ windowId }, "Settling market window");

  const [win] = await db
    .select()
    .from(marketWindowsTable)
    .where(eq(marketWindowsTable.id, windowId))
    .limit(1);

  if (!win) {
    logger.error({ windowId }, "Window not found for settlement");
    return;
  }

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
      .set({ status: isWinner ? "won" : "lost", payoutSats })
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
    .where(eq(marketWindowsTable.id, windowId));

  logger.info(
    { windowId, outcome, openPrice: openPriceNum, closePrice, totalPool, winners: winners.length },
    "Window settled",
  );
}

async function runMarketCycle(): Promise<void> {
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
}

let engineRunning = false;

export function startMarketEngine(): void {
  if (engineRunning) return;
  engineRunning = true;

  logger.info("Market engine starting");

  runMarketCycle().catch(err =>
    logger.error({ err }, "Initial market cycle failed"),
  );

  setInterval(() => {
    runMarketCycle().catch(err =>
      logger.error({ err }, "Market watchdog cycle error"),
    );
  }, WATCHDOG_INTERVAL_MS);
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
