import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, betsTable, webhookEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getConfig } from "../lib/config";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function verifyAlbySignature(rawBody: Buffer, receivedSig: string, secret: string): boolean {
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");

  const sigToCompare = receivedSig.startsWith("v1=")
    ? receivedSig.slice(3)
    : receivedSig;

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sigToCompare, "hex"));
  } catch {
    return false;
  }
}

function extractPaymentHash(body: Record<string, unknown>): string | null {
  if (typeof body.payment_hash === "string") return body.payment_hash;
  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = (data as Record<string, unknown>).payment_hash;
    if (typeof nested === "string") return nested;
  }
  return null;
}

router.post("/webhook/alby", async (req, res): Promise<void> => {
  const { webhookSecret } = getConfig();

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.warn("Webhook received without rawBody — cannot verify signature");
    res.status(400).json({ error: "Missing raw body for signature verification" });
    return;
  }

  const sigHeader =
    (req.headers["x-alby-signature"] as string | undefined) ??
    (req.headers["alby-signature"] as string | undefined) ??
    (req.headers["webhook-signature"] as string | undefined);

  if (!sigHeader) {
    logger.warn({ headers: Object.keys(req.headers) }, "Webhook missing signature header");
    res.status(401).json({ error: "Missing webhook signature" });
    return;
  }

  const isValid = verifyAlbySignature(rawBody, sigHeader, webhookSecret);
  if (!isValid) {
    logger.warn({ sigHeader }, "Webhook signature verification failed");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const paymentHash = extractPaymentHash(body);

  if (!paymentHash) {
    logger.warn({ body }, "Webhook payload missing payment_hash");
    res.status(400).json({ error: "Missing payment_hash in payload" });
    return;
  }

  logger.info({ paymentHash }, "Alby webhook received");

  const existingEvent = await db
    .select()
    .from(webhookEventsTable)
    .where(
      and(
        eq(webhookEventsTable.paymentHash, paymentHash),
        eq(webhookEventsTable.processed, true),
      ),
    )
    .limit(1);

  if (existingEvent.length > 0) {
    logger.info({ paymentHash }, "Webhook already processed — idempotent response");
    res.json({ ok: true });
    return;
  }

  await db.insert(webhookEventsTable).values({
    paymentHash,
    payload: JSON.stringify(body),
    processed: false,
  });

  const [bet] = await db
    .select()
    .from(betsTable)
    .where(eq(betsTable.paymentHash, paymentHash))
    .limit(1);

  if (!bet) {
    logger.warn({ paymentHash }, "Webhook received for unknown payment hash");
    await db
      .update(webhookEventsTable)
      .set({ processed: true })
      .where(eq(webhookEventsTable.paymentHash, paymentHash));
    res.json({ ok: true });
    return;
  }

  if (bet.status !== "pending") {
    logger.info({ paymentHash, status: bet.status }, "Bet already processed");
    await db
      .update(webhookEventsTable)
      .set({ processed: true })
      .where(eq(webhookEventsTable.paymentHash, paymentHash));
    res.json({ ok: true });
    return;
  }

  await db
    .update(betsTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(betsTable.paymentHash, paymentHash), eq(betsTable.status, "pending")));

  await db
    .update(webhookEventsTable)
    .set({ processed: true })
    .where(eq(webhookEventsTable.paymentHash, paymentHash));

  logger.info({ paymentHash, betId: bet.id, windowId: bet.windowId }, "Bet marked as paid");

  res.json({ ok: true });
});

export default router;
