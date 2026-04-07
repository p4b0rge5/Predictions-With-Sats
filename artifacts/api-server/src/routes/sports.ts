import { Router, type IRouter } from "express";
import { getSportsEvents } from "../lib/sports";

const router: IRouter = Router();

router.get("/sports/events", async (_req, res): Promise<void> => {
  try {
    const data = await getSportsEvents();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch sports events" });
  }
});

export default router;
