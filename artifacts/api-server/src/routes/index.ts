import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import betRouter from "./bet";
import webhookRouter from "./webhook";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(betRouter);
router.use(webhookRouter);
router.use(statsRouter);

export default router;
