import app from "./app";
import { logger } from "./lib/logger";
import { startMarketEngine } from "./lib/market";
import { initConfig } from "./lib/config";
import { ensureWebhookRegistered } from "./lib/alby";
import { startPaymentPoller } from "./lib/payment-poller";
import { startSportsPollers } from "./lib/sports-pollers";
import { startWeatherPollers } from "./lib/weather-pollers";
import { checkCoinosTokenHealth } from "./lib/coinos";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const config = initConfig();
logger.info({ lightningAddress: config.lightningAddress }, "Configuration validated");

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startMarketEngine();
  startPaymentPoller();
  startSportsPollers();
  startWeatherPollers();
  // Check Coinos token on startup; re-check every hour
  checkCoinosTokenHealth().catch(() => {});
  setInterval(() => checkCoinosTokenHealth().catch(() => {}), 60 * 60 * 1000);

  if (config.webhookUrl) {
    ensureWebhookRegistered(config.webhookUrl).catch((e) =>
      logger.error({ err: e }, "Webhook registration failed"),
    );
  } else {
    logger.warn(
      "WEBHOOK_URL not set — Alby payment notifications will not be auto-registered. " +
      "Add your webhook manually at https://getalby.com/developer/webhooks → " +
      "URL: https://<your-domain>/api/webhook/alby",
    );
  }
});
