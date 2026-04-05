import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

app.use(
  express.json({
    verify(req: Request, _res: Response, buf: Buffer) {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: _err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
