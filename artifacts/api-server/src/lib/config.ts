function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${key}. Set it in Replit Secrets.`,
    );
  }
  return val;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key] || undefined;
}

export interface AppConfig {
  /** Bearer token for the Alby REST API (used for webhook management only). */
  albyApiToken: string;
  /** Lightning Address that receives bets, e.g. yourname@getalby.com */
  lightningAddress: string;
  /** HMAC secret used to verify Alby webhook signatures. */
  webhookSecret: string;
  /**
   * Full public URL of this server's Alby webhook endpoint.
   * When set, the server will auto-register the webhook with Alby on startup.
   * Example: https://my-repl.replit.app/api/webhook/alby
   */
  webhookUrl: string | undefined;
}

export function loadConfig(): AppConfig {
  return {
    albyApiToken: requireEnv("ALBY_API_TOKEN"),
    lightningAddress: requireEnv("LIGHTNING_ADDRESS"),
    webhookSecret: requireEnv("WEBHOOK_SECRET"),
    webhookUrl: optionalEnv("WEBHOOK_URL"),
  };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error("Config not initialized. Call initConfig() first.");
  }
  return _config;
}

export function initConfig(): AppConfig {
  _config = loadConfig();
  return _config;
}
