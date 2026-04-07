import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getCoinosTokenStatus } from "../lib/coinos";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/coinos/status", (_req, res) => {
  const status = getCoinosTokenStatus();
  res.json(status);
});

export default router;
