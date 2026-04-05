import { Router, type IRouter } from "express";
import {
  GetCurrentMarketResponse,
  GetMarketHistoryQueryParams,
  GetMarketHistoryResponse,
} from "@workspace/api-zod";
import {
  getLatestWindow,
  getSettledWindows,
  getWindowBetTotals,
  getWindowClosesAt,
} from "../lib/market";
import { getCachedBtcPrice, getLastKnownPrice } from "../lib/price";

const router: IRouter = Router();

router.get("/market/current", async (req, res): Promise<void> => {
  const [latestWin, btcPrice] = await Promise.allSettled([
    getLatestWindow(),
    getCachedBtcPrice(),
  ]);

  const win = latestWin.status === "fulfilled" ? latestWin.value : null;
  const price =
    btcPrice.status === "fulfilled"
      ? btcPrice.value
      : (getLastKnownPrice() ?? 0);

  if (btcPrice.status === "rejected") {
    req.log.warn({ err: btcPrice.reason }, "Failed to fetch BTC price for /market/current");
  }

  let windowId: number | null = null;
  let status = "none";
  let openPrice: number | null = null;
  let secondsRemaining = 0;
  let closesAt: Date | null = null;
  let totalUpSats = 0;
  let totalDownSats = 0;

  if (win && (win.status === "open" || win.status === "closed")) {
    windowId = win.id;
    status = win.status;
    openPrice = win.openPrice !== null ? parseFloat(win.openPrice) : null;
    closesAt = getWindowClosesAt(win.openedAt);
    secondsRemaining = Math.max(0, Math.floor((closesAt.getTime() - Date.now()) / 1000));

    const totals = await getWindowBetTotals(win.id);
    totalUpSats = totals.totalUpSats;
    totalDownSats = totals.totalDownSats;
  }

  const data = GetCurrentMarketResponse.parse({
    windowId,
    status,
    btcPriceUsd: price,
    openPrice,
    secondsRemaining,
    totalUpSats,
    totalDownSats,
    closesAt: closesAt?.toISOString() ?? null,
  });

  res.json(data);
});

router.get("/market/history", async (req, res): Promise<void> => {
  const params = GetMarketHistoryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const windows = await getSettledWindows(params.data.limit);

  const data = GetMarketHistoryResponse.parse(
    windows.map(w => {
      const open = w.openPrice !== null ? parseFloat(w.openPrice) : null;
      const close = w.closePrice !== null ? parseFloat(w.closePrice) : null;
      const priceChangePercent =
        open !== null && close !== null && open > 0
          ? ((close - open) / open) * 100
          : null;
      return {
        id: w.id,
        outcome: w.outcome,
        openPrice: open,
        closePrice: close,
        priceChangePercent,
        totalUpSats: w.totalUpSats,
        totalDownSats: w.totalDownSats,
        openedAt: w.openedAt.toISOString(),
        settledAt: w.settledAt?.toISOString() ?? null,
      };
    }),
  );

  res.json(data);
});

export default router;
