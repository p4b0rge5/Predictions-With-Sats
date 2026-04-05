function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing required environment variable: ${key}. Set it in Replit Secrets.`,
    );
  }
  return val;
}

export interface AppConfig {
  albyApiToken: string;
  webhookSecret: string;
}

export function loadConfig(): AppConfig {
  return {
    albyApiToken: requireEnv("ALBY_API_TOKEN"),
    webhookSecret: requireEnv("WEBHOOK_SECRET"),
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
