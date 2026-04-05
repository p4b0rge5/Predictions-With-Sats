import { Router, type IRouter } from "express";
import {
  CreateBetBody,
  GetBetStatusParams,
  GetBetStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/bet", async (req, res): Promise<void> => {
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  req.log.info({ direction: parsed.data.direction }, "POST /bet stub");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  res.status(201).json({
    id: 1,
    paymentHash: "stub_payment_hash_000000000000000000000000000000000000000000000000",
    paymentRequest: "lnbc1stub",
    amountSats: Math.round((parsed.data.amountUsd / 95000) * 100_000_000),
    direction: parsed.data.direction,
    expiresAt,
    windowId: 1,
  });
});

router.get("/bet/:paymentHash", async (req, res): Promise<void> => {
  const params = GetBetStatusParams.safeParse({ paymentHash: req.params.paymentHash });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  req.log.info({ paymentHash: params.data.paymentHash }, "GET /bet/:paymentHash stub");
  const data = GetBetStatusResponse.parse({
    id: 1,
    paymentHash: params.data.paymentHash,
    direction: "up",
    amountSats: 1000,
    status: "pending",
    payoutSats: null,
    windowId: 1,
    createdAt: new Date().toISOString(),
    paidAt: null,
  });
  res.json(data);
});

export default router;
