import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketRouter from "./market";
import betRouter from "./bet";
import webhookRouter from "./webhook";
import statsRouter from "./stats";
import withdrawRouter from "./withdraw";
import sportsRouter from "./sports";
import weatherRouter from "./weather";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketRouter);
router.use(betRouter);
router.use(webhookRouter);
router.use(statsRouter);
router.use(withdrawRouter);
router.use(sportsRouter);
router.use(weatherRouter);

export default router;
