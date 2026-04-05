import { Router, type IRouter } from "express";
import { AlbyWebhookResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/webhook/alby", async (req, res): Promise<void> => {
  req.log.info("POST /webhook/alby");
  const data = AlbyWebhookResponse.parse({ ok: true });
  res.json(data);
});

export default router;
