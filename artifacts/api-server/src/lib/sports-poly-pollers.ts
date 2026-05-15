import { db, sportPolyBetsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { runSportsPolySettlementCycle, addToSportsPolyPool } from "./sports-poly";

const PAYMENT_POLL_INTERVAL_MS = 5_000;
const SETTLEMENT_POLL_INTERVAL_MS = 2 * 60 * 60 * 1000;
const MAX_POLL_AGE_MS = 24 * 60 * 60 * 1000;

async function checkLud21(verifyUrl: string): Promise<boolean> {
  try {
    const res = await fetch(verifyUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const body = await res.json() as { settled?: boolean; preimage?: string | null };
    return body.settled === true && typeof body.preimage === "string" && body.preimage.length > 0;
  } catch {
    return false;
  }
}

async function pollSportsPolyPayments(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_POLL_AGE_MS);
  const pendingBets = await db
    .select()
    .from(sportPolyBetsTable)
    .where(eq(sportPolyBetsTable.status, "pending"));

  for (const bet of pendingBets) {
    if (bet.createdAt < cutoff) {
      await db
        .update(sportPolyBetsTable)
        .set({ status: "expired" })
        .where(and(eq(sportPolyBetsTable.id, bet.id), eq(sportPolyBetsTable.status, "pending")));
      logger.info({ sportPolyBetId: bet.id }, "Sports Poly bet expired");
      continue;
    }

    if (!bet.verifyUrl) continue;

    const paid = await checkLud21(bet.verifyUrl);
    if (!paid) continue;

    await db
      .update(sportPolyBetsTable)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(sportPolyBetsTable.id, bet.id), eq(sportPolyBetsTable.status, "pending")));

    try {
      await addToSportsPolyPool(bet.marketId, bet.direction, bet.amountSats);
    } catch (err) {
      logger.warn({ err, sportPolyBetId: bet.id }, "Failed to add to Sports Poly pool");
    }

    logger.info({ sportPolyBetId: bet.id }, "Sports Poly bet confirmed via LUD-21");
  }
}

let paymentTimer: ReturnType<typeof setInterval> | null = null;
let settlementTimer: ReturnType<typeof setInterval> | null = null;

export function startSportsPolyPollers(): void {
  if (paymentTimer) return;

  paymentTimer = setInterval(() => {
    pollSportsPolyPayments().catch((err) =>
      logger.warn({ err }, "Sports Poly payment poller error"),
    );
  }, PAYMENT_POLL_INTERVAL_MS);

  settlementTimer = setInterval(() => {
    runSportsPolySettlementCycle().catch((err) =>
      logger.warn({ err }, "Sports Poly settlement poller error"),
    );
  }, SETTLEMENT_POLL_INTERVAL_MS);

  runSportsPolySettlementCycle().catch((err) =>
    logger.warn({ err }, "Sports Poly settlement startup error"),
  );

  logger.info("Sports Poly pollers started");
}

export function stopSportsPolyPollers(): void {
  if (paymentTimer) { clearInterval(paymentTimer); paymentTimer = null; }
  if (settlementTimer) { clearInterval(settlementTimer); settlementTimer = null; }
}
