import { Router, type IRouter } from "express";
import { AlbyWebhookBody, AlbyWebhookResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/webhook/alby", async (req, res): Promise<void> => {
  const parsed = AlbyWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }
  req.log.info("POST /webhook/alby stub");
  const data = AlbyWebhookResponse.parse({ ok: true });
  res.json(data);
});

export default router;
