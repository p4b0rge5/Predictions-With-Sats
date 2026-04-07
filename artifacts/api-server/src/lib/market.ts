import cron from "node-cron";
import { randomUUID } from "node:crypto";
import { db, marketWindowsTable, betsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { fetchAndStoreBtcPrice, fetchPricesRaw, storePriceSnapshots } from "./price";
import { logger } from "./logger";

// ── Constants ──────────────────────────────────────────────────────────────────

const WINDOW_DURATION_MS = 5 * 60 * 1000; // 300 000 ms — 5 minutes
const SETTLEMENT_BUFFER_MS = 0;            // 0 s — use cached price at close (refreshed every cycle)

// Platform fee: 2% taken from every settled window (winners or refunds).
const PLATFORM_FEE = 0.02;

// ── Epoch helpers ──────────────────────────────────────────────────────────────
// Windows are aligned to UTC 5-minute boundaries: :00, :05, :10, … :55
// This mirrors the approach used by high-frequency prediction markets (Polymarket,
// Drift, etc.) where every window starts and ends at a globally deterministic time.

/** Index of the 5-minute epoch that contains `timestampMs`. */
function epochIndexOf(timestampMs: number): number {
  return Math.floor(timestampMs / WINDOW_DURATION_MS);
}

/** Exact UTC start of the epoch that contains `timestampMs`. */
function epochStartOf(timestampMs: number): Date {
  return new Date(epochIndexOf(timestampMs) * WINDOW_DURATION_MS);
}

/** The window's deterministic close time = openedAt + 5 min. */
export function getWindowClosesAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + WINDOW_DURATION_MS);
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

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

// ── Window lifecycle ───────────────────────────────────────────────────────────

/**
 * Create a new window anchored to `openedAt` (an epoch boundary).
 * Passing the timestamp explicitly — rather than relying on DB `defaultNow()` —
 * ensures the window's duration is always exactly 300 s regardless of when the
 * INSERT actually runs.
 */
async function createNewWindow(openedAt: Date): Promise<void> {
  logger.info("Creating new market window");
  const { sources, price: openPrice } = await fetchPricesRaw();
  const [win] = await db
    .insert(marketWindowsTable)
    .values({ openedAt, openPrice: openPrice.toFixed(2), status: "open" })
    .returning();
  await storePriceSnapshots(win.id, false, sources);
  logger.info({ windowId: win.id, openPrice, openedAt }, "Market window opened");
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

  const paidBets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));

  const upBets = paidBets.filter((b) => b.direction === "up");
  const downBets = paidBets.filter((b) => b.direction === "down");

  // ── No-liquidity: one side has zero bets — refund everyone at (1 - fee) ─────
  const hasNoLiquidity =
    paidBets.length > 0 && (upBets.length === 0 || downBets.length === 0);

  let outcome: "up" | "down" | "draw" | "no_liquidity";

  if (hasNoLiquidity) {
    outcome = "no_liquidity";

    for (const bet of paidBets) {
      const refundSats = Math.floor(bet.amountSats * (1 - PLATFORM_FEE));
      await db
        .update(betsTable)
        .set({
          status: "won",
          payoutSats: refundSats,
          withdrawToken: randomUUID(),
          withdrawStatus: "unclaimed",
        })
        .where(eq(betsTable.id, bet.id));
    }

    logger.info(
      { windowId, refundedBets: paidBets.length },
      "No-liquidity window — all bets refunded at 98%",
    );
  } else {
    // ── Normal settlement ──────────────────────────────────────────────────────
    if (closePrice > openPriceNum) outcome = "up";
    else if (closePrice < openPriceNum) outcome = "down";
    else outcome = "draw";

    const totalPool = paidBets.reduce((sum, b) => sum + b.amountSats, 0);
    const payablePool = Math.floor(totalPool * (1 - PLATFORM_FEE)); // 2% fee
    const winners =
      outcome === "draw" ? paidBets : paidBets.filter((b) => b.direction === outcome);
    const totalWinnerStake = winners.reduce((sum, b) => sum + b.amountSats, 0);

    for (const bet of paidBets) {
      const isWinner = outcome === "draw" || bet.direction === outcome;
      const payoutSats: number | null = isWinner
        ? totalWinnerStake > 0
          ? Math.floor((bet.amountSats / totalWinnerStake) * payablePool)
          : bet.amountSats
        : null;

      await db
        .update(betsTable)
        .set({
          status: isWinner ? "won" : "lost",
          payoutSats,
          ...(isWinner
            ? { withdrawToken: randomUUID(), withdrawStatus: "unclaimed" }
            : {}),
        })
        .where(eq(betsTable.id, bet.id));
    }

    logger.info(
      { windowId, outcome, openPrice: openPriceNum, closePrice, totalPool },
      "Window settled",
    );
  }

  // Expire any bets that were never paid (invoice unpaid when window settled)
  await db
    .update(betsTable)
    .set({ status: "expired" })
    .where(
      and(eq(betsTable.windowId, windowId), eq(betsTable.status, "pending")),
    );

  await db
    .update(marketWindowsTable)
    .set({
      closePrice: closePrice.toFixed(2),
      outcome,
      status: "settled",
      settledAt: new Date(),
    })
    .where(
      and(
        eq(marketWindowsTable.id, windowId),
        eq(marketWindowsTable.status, "closed"),
      ),
    );
}

// ── Market cycle (epoch-aligned) ───────────────────────────────────────────────

let cycleRunning = false;

async function runMarketCycle(): Promise<void> {
  if (cycleRunning) {
    logger.debug("Market cycle already running — skipping");
    return;
  }
  cycleRunning = true;
  try {
    const now = Date.now();
    const currentEpochStart = epochStartOf(now);
    const currentEpochIdx = epochIndexOf(now);

    const latest = await getLatestWindow();

    // ── No window at all → open one for the current epoch ──────────────────────
    if (!latest) {
      await createNewWindow(currentEpochStart);
      return;
    }

    const latestEpochIdx = epochIndexOf(latest.openedAt.getTime());

    // ── Latest window is settled and belongs to a past epoch → open current ────
    if (latest.status === "settled" && latestEpochIdx < currentEpochIdx) {
      await createNewWindow(currentEpochStart);
      return;
    }

    // ── Open window: close it when the epoch boundary has passed ───────────────
    if (latest.status === "open") {
      const closesAt = getWindowClosesAt(latest.openedAt);
      if (now >= closesAt.getTime()) {
        await closeWindow(latest.id);
      }
      return;
    }

    // ── Closed window: settle after the buffer, then open the current epoch ────
    if (latest.status === "closed" && latest.closedAt) {
      const settleAt = latest.closedAt.getTime() + SETTLEMENT_BUFFER_MS;
      if (now >= settleAt) {
        await settleWindow(latest.id);
        // Open the window for the current epoch (may have already started)
        await createNewWindow(currentEpochStart);
      }
      return;
    }
  } catch (err) {
    logger.error({ err }, "Market cycle error");
  } finally {
    cycleRunning = false;
  }
}

// ── Engine bootstrap ───────────────────────────────────────────────────────────

let engineStarted = false;

export function startMarketEngine(): void {
  if (engineStarted) return;
  engineStarted = true;

  logger.info("Market engine starting");

  // Run immediately on startup, then every 10 s
  runMarketCycle().catch((err) =>
    logger.error({ err }, "Initial market cycle failed"),
  );

  cron.schedule("*/10 * * * * *", () => {
    runMarketCycle().catch((err) =>
      logger.error({ err }, "Scheduled market cycle error"),
    );
  });
}

// ── Public query helpers ───────────────────────────────────────────────────────

export async function getWindowBetTotals(
  windowId: number,
): Promise<{ totalUpSats: number; totalDownSats: number }> {
  const bets = await db
    .select()
    .from(betsTable)
    .where(and(eq(betsTable.windowId, windowId), eq(betsTable.status, "paid")));
  const totalUpSats = bets
    .filter((b) => b.direction === "up")
    .reduce((s, b) => s + b.amountSats, 0);
  const totalDownSats = bets
    .filter((b) => b.direction === "down")
    .reduce((s, b) => s + b.amountSats, 0);
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
      totalSettled: db.$count(
        marketWindowsTable,
        eq(marketWindowsTable.status, "settled"),
      ),
    })
    .from(marketWindowsTable);

  const upWinCount = await db.$count(
    marketWindowsTable,
    and(
      eq(marketWindowsTable.status, "settled"),
      eq(marketWindowsTable.outcome, "up"),
    ),
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
