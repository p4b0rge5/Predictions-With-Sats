import { Router, type IRouter } from "express";
import {
  GetCurrentMarketResponse,
  GetMarketHistoryQueryParams,
  GetMarketHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/market/current", async (req, res): Promise<void> => {
  req.log.info("GET /market/current");
  const now = new Date();
  const closesAt = new Date(now.getTime() + 4 * 60 * 1000);
  const data = GetCurrentMarketResponse.parse({
    windowId: null,
    status: "none",
    btcPriceUsd: 0,
    openPrice: null,
    secondsRemaining: 0,
    totalUpSats: 0,
    totalDownSats: 0,
    closesAt: closesAt.toISOString(),
  });
  res.json(data);
});

router.get("/market/history", async (req, res): Promise<void> => {
  req.log.info("GET /market/history");
  const params = GetMarketHistoryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const data = GetMarketHistoryResponse.parse([]);
  res.json(data);
});

export default router;
