import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import betRouter from "./bet";
import webhookRouter from "./webhook";
import statsRouter from "./stats";
import withdrawRouter from "./withdraw";
import sportsRouter from "./sports";
import sportsPolyRouter from "./sports-poly";
import weatherRouter from "./weather";
import nostrRouter from "./nostr";
import zapRouter, { getLnurlMetadataRoute } from "./lnurl-zap";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(betRouter);
router.use(webhookRouter);
router.use(statsRouter);
router.use(withdrawRouter);
router.use(sportsRouter);
router.use(sportsPolyRouter);
router.use(weatherRouter);
router.use("/admin/nostr", nostrRouter);
// NIP-57 zap receiver routes
router.use("/lnurl-zap", zapRouter);

export default router;

// LNURL metadata route (must be mounted at root, not under /api/)
export const lnurlMetadataRouter = getLnurlMetadataRoute();
