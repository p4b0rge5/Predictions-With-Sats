import { Router, type IRouter } from "express";
import { GetPlatformStatsResponse } from "@workspace/api-zod";
import { getPlatformStats } from "../lib/market";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const stats = await getPlatformStats();
  const data = GetPlatformStatsResponse.parse(stats);
  res.json(data);
});

export default router;
