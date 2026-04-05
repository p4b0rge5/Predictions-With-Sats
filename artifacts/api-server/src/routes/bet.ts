import { Router, type IRouter } from "express";
import {
  CreateBetBody,
  GetBetStatusParams,
  GetBetStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/bet", async (req, res): Promise<void> => {
  req.log.info("POST /bet");
  const parsed = CreateBetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(400).json({ error: "No active market window" });
});

router.get("/bet/:paymentHash", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.paymentHash)
    ? req.params.paymentHash[0]
    : req.params.paymentHash;
  const params = GetBetStatusParams.safeParse({ paymentHash: raw });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  req.log.info({ paymentHash: params.data.paymentHash }, "GET /bet/:paymentHash");
  res.status(404).json({ error: "Bet not found" });
});

export default router;
