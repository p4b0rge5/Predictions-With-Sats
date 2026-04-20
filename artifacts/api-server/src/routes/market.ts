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
  SUPPORTED_INTERVALS,
  type IntervalMinutes,
} from "../lib/market";
import { getCachedPrice, getLastKnownPrice, type CryptoAsset } from "../lib/price";

const router: IRouter = Router();

const VALID_ASSETS: CryptoAsset[] = ["btc", "eth", "sol", "xrp", "bnb"];

function parseAsset(raw: unknown): CryptoAsset {
  if (typeof raw === "string" && VALID_ASSETS.includes(raw as CryptoAsset)) {
    return raw as CryptoAsset;
  }
  return "btc";
}

function parseInterval(raw: unknown): number {
  const n = Number(raw);
  return SUPPORTED_INTERVALS.includes(n as IntervalMinutes) ? n : 5;
}

router.get("/market/current", async (req, res): Promise<void> => {
  const asset = parseAsset(req.query.asset);
  const intervalMinutes = parseInterval(req.query.interval);

  const [latestWin, assetPrice] = await Promise.allSettled([
    getLatestWindow(asset, intervalMinutes),
    getCachedPrice(asset),
  ]);

  const win = latestWin.status === "fulfilled" ? latestWin.value : null;
  const price =
    assetPrice.status === "fulfilled"
      ? assetPrice.value
      : (getLastKnownPrice(asset) ?? 0);

  if (assetPrice.status === "rejected") {
    req.log.warn({ err: assetPrice.reason, asset }, "Failed to fetch price for /market/current");
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
    closesAt = getWindowClosesAt(win.openedAt, intervalMinutes);
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

  const asset = parseAsset(req.query.asset);
  const intervalMinutes = parseInterval(req.query.interval);
  const windows = await getSettledWindows(params.data.limit, asset, intervalMinutes);

  const data = GetMarketHistoryResponse.parse(
    windows.map((w) => {
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
