import { Router, type IRouter } from "express";
import { GetPlatformStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats", async (req, res): Promise<void> => {
  req.log.info("GET /stats");
  const data = GetPlatformStatsResponse.parse({
    totalBets: 0,
    totalVolumeSats: 0,
    totalWindowsSettled: 0,
    upWinRate: 0,
  });
  res.json(data);
});

export default router;
