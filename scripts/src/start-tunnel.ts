import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const envFilePath = path.join(repoRoot, ".env");
const localCloudflaredPath = path.join(repoRoot, ".local/bin/cloudflared");
const tunnelUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const rawArgs = process.argv.slice(2);
const normalizedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

const args = parseArgs({
  args: normalizedArgs,
  options: {
    "api-port": { type: "string" },
    "frontend-port": { type: "string" },
    "notify-webhook": { type: "string" },
    "telegram-bot-token": { type: "string" },
    "telegram-chat-id": { type: "string" },
    "sync-webhook": { type: "boolean", default: false },
    "target-url": { type: "string" },
    "tunnel-token": { type: "string" },
    "public-base-url": { type: "string" },
  },
});

const requestedApiPort = args.values["api-port"] ?? process.env["API_PORT"] ?? "3001";
const requestedFrontendPort =
  args.values["frontend-port"] ?? process.env["FRONTEND_PORT"] ?? "3000";
const syncWebhook = args.values["sync-webhook"] ?? false;
const explicitTunnelTargetUrl =
  args.values["target-url"] ?? process.env["TUNNEL_TARGET_URL"] ?? null;
const configuredTunnelToken = firstNonEmpty(
  args.values["tunnel-token"],
  process.env["CLOUDFLARED_TUNNEL_TOKEN"],
  process.env["TUNNEL_TOKEN"],
);
const configuredPublicBaseUrl = firstNonEmpty(
  args.values["public-base-url"],
  process.env["TUNNEL_PUBLIC_BASE_URL"],
);

type ProcessLabel = "tunnel" | "api" | "frontend" | "manager";

let apiPort = parsePort(requestedApiPort, "api-port");
let frontendPort = parsePort(requestedFrontendPort, "frontend-port");

let shuttingDown = false;
let currentPublicBaseUrl: string | null = null;
let tunnelProcess: ChildProcess | null = null;
let apiProcess: ChildProcess | null = null;
let frontendProcess: ChildProcess | null = null;
let apiStarted = false;
let frontendStarted = false;
let restartingApi = false;
let startingApi = false;
let startingFrontend = false;

interface NotificationConfig {
  webhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

function log(scope: ProcessLabel, message: string): void {
  process.stdout.write(`[${scope}] ${message}\n`);
}

function parsePort(rawValue: string, label: string): number {
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid ${label}: ${rawValue}`);
  }
  return port;
}

function getTunnelTargetUrl(): string {
  return explicitTunnelTargetUrl ?? `http://127.0.0.1:${frontendPort}`;
}

function readLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;

  const rl = readline.createInterface({ input: stream });
  rl.on("line", onLine);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCloudflaredCommand(): Promise<string> {
  if (await fileExists(localCloudflaredPath)) {
    return localCloudflaredPath;
  }

  return "cloudflared";
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(preferredPort: number, reservedPorts: Set<number>): Promise<number> {
  let candidate = preferredPort;

  while (candidate <= 65535 && (reservedPorts.has(candidate) || !(await isPortAvailable(candidate)))) {
    candidate += 1;
  }

  if (candidate > 65535) {
    const reservedList =
      reservedPorts.size > 0 ? ` Reserved ports: ${Array.from(reservedPorts).join(", ")}.` : "";
    throw new Error(
      `no available port found starting at ${preferredPort} and ending at 65535.${reservedList}`,
    );
  }

  return candidate;
}

async function resolveRuntimePorts(): Promise<void> {
  const resolvedApiPort = await findAvailablePort(apiPort, new Set());
  const resolvedFrontendPort = await findAvailablePort(frontendPort, new Set([resolvedApiPort]));

  if (resolvedApiPort !== apiPort) {
    log("manager", `porta da api ${apiPort} indisponivel; usando ${resolvedApiPort}`);
  }

  if (resolvedFrontendPort !== frontendPort) {
    log("manager", `porta do frontend ${frontendPort} indisponivel; usando ${resolvedFrontendPort}`);
  }

  apiPort = resolvedApiPort;
  frontendPort = resolvedFrontendPort;
}

function parseEnvFile(input: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const exportPrefix = trimmed.startsWith("export ") ? "export " : "";
    const normalized = exportPrefix ? trimmed.slice(exportPrefix.length) : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = normalized.slice(0, separatorIndex).trim();
    const rawValue = normalized.slice(separatorIndex + 1).trim();
    const value =
      (rawValue.startsWith("\"") && rawValue.endsWith("\"")) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    entries.set(key, value);
  }

  return entries;
}

async function loadEnvFile(): Promise<Map<string, string>> {
  const raw = await readFile(envFilePath, "utf8");
  return parseEnvFile(raw);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

async function resolveNotificationConfig(): Promise<NotificationConfig> {
  const fileEnv = await loadEnvFile();

  return {
    webhookUrl: firstNonEmpty(
      args.values["notify-webhook"],
      process.env["TUNNEL_NOTIFY_WEBHOOK_URL"],
      process.env["PUBLIC_URL_NOTIFY_WEBHOOK_URL"],
      fileEnv.get("TUNNEL_NOTIFY_WEBHOOK_URL"),
      fileEnv.get("PUBLIC_URL_NOTIFY_WEBHOOK_URL"),
    ),
    telegramBotToken: firstNonEmpty(
      args.values["telegram-bot-token"],
      process.env["TELEGRAM_BOT_TOKEN"],
      fileEnv.get("TELEGRAM_BOT_TOKEN"),
    ),
    telegramChatId: firstNonEmpty(
      args.values["telegram-chat-id"],
      process.env["TELEGRAM_CHAT_ID"],
      fileEnv.get("TELEGRAM_CHAT_ID"),
    ),
  };
}

async function updateEnvValue(key: string, value: string): Promise<void> {
  const raw = await readFile(envFilePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let found = false;

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const exportPrefix = trimmed.startsWith("export ") ? "export " : "";
    const normalized = exportPrefix ? trimmed.slice(exportPrefix.length) : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) return line;

    const currentKey = normalized.slice(0, separatorIndex).trim();
    if (currentKey !== key) return line;

    found = true;
    return `${exportPrefix}${key}=${value}`;
  });

  if (!found) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${value}`);
  }

  await writeFile(envFilePath, `${nextLines.join("\n").replace(/\n*$/, "\n")}`, "utf8");
}

async function notifyPublicUrlChange(
  publicBaseUrl: string,
  previousPublicBaseUrl: string | null,
): Promise<void> {
  const notificationConfig = await resolveNotificationConfig();
  const { webhookUrl, telegramBotToken, telegramChatId } = notificationConfig;

  const payload = {
    event: "public_url_changed",
    project: "Predictions With Sats",
    publicBaseUrl,
    previousPublicBaseUrl,
    frontendUrl: publicBaseUrl,
    apiHealthUrl: `${publicBaseUrl}/api/healthz`,
    timestamp: new Date().toISOString(),
  };

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "pwsats-tunnel-manager/1.0",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        log(
          "manager",
          `falha ao notificar mudanca de URL publica (${response.status} ${response.statusText})`,
        );
      } else {
        log("manager", `notificacao enviada para ${webhookUrl}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("manager", `erro ao enviar notificacao da URL publica: ${message}`);
    }
  }

  if (telegramBotToken && telegramChatId) {
    const text = [
      "Predictions With Sats",
      "",
      "Nova URL publica disponivel:",
      publicBaseUrl,
      "",
      `API health: ${publicBaseUrl}/api/healthz`,
      ...(previousPublicBaseUrl ? ["", `URL anterior: ${previousPublicBaseUrl}`] : []),
    ].join("\n");

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "pwsats-tunnel-manager/1.0",
          },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text,
            disable_web_page_preview: true,
          }),
        },
      );

      if (!response.ok) {
        log(
          "manager",
          `falha ao enviar notificacao para Telegram (${response.status} ${response.statusText})`,
        );
      } else {
        log("manager", `notificacao enviada ao Telegram chat ${telegramChatId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("manager", `erro ao enviar notificacao ao Telegram: ${message}`);
    }
  }
}

async function stopChild(child: ChildProcess | null, label: Exclude<ProcessLabel, "manager">): Promise<void> {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 5000);

    child.once("exit", () => {
      clearTimeout(timeout);
      log("manager", `${label} finalizado`);
      resolve();
    });
  });
}

async function stopApi(): Promise<void> {
  const child = apiProcess;
  apiProcess = null;
  apiStarted = false;
  await stopChild(child, "api");
}

async function stopFrontend(): Promise<void> {
  const child = frontendProcess;
  frontendProcess = null;
  frontendStarted = false;
  await stopChild(child, "frontend");
}

function wireProcessLogs(
  child: ChildProcess,
  label: "api" | "frontend",
  onUnexpectedExit: () => void,
): void {
  readLines(child.stdout, (line) => log(label, line));
  readLines(child.stderr, (line) => log(label, line));

  child.on("exit", (code, signal) => {
    log("manager", `${label} saiu (code=${code ?? "null"}, signal=${signal ?? "null"})`);
    onUnexpectedExit();
  });
}

async function startApi(): Promise<void> {
  if (apiStarted || startingApi) return;
  startingApi = true;

  try {
    const fileEnv = await loadEnvFile();
    const childEnv = Object.fromEntries(fileEnv);
    Object.assign(childEnv, process.env);

    childEnv["PORT"] = String(apiPort);
    childEnv["API_PORT"] = String(apiPort);
    childEnv["NODE_ENV"] = childEnv["NODE_ENV"] ?? "development";

    const child = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "dev"], {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    apiProcess = child;
    apiStarted = true;

    wireProcessLogs(child, "api", () => {
      if (apiProcess !== child) return;
      apiProcess = null;
      apiStarted = false;

      if (!shuttingDown && !restartingApi) {
        log("manager", "api encerrou fora do fluxo de restart");
      }
    });

    log("manager", `api iniciada com PUBLIC_BASE_URL=${childEnv["PUBLIC_BASE_URL"] ?? "(ausente)"}`);
  } finally {
    startingApi = false;
  }
}

async function startFrontend(): Promise<void> {
  if (frontendStarted || startingFrontend) return;
  startingFrontend = true;

  try {
    const fileEnv = await loadEnvFile();
    const childEnv = Object.fromEntries(fileEnv);
    Object.assign(childEnv, process.env);

    childEnv["PORT"] = String(frontendPort);
    childEnv["API_PORT"] = String(apiPort);
    childEnv["FRONTEND_PORT"] = String(frontendPort);
    childEnv["BASE_PATH"] = childEnv["BASE_PATH"] ?? "/";
    childEnv["NODE_ENV"] = childEnv["NODE_ENV"] ?? "development";

    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/predictions-with-sats-web", "run", "dev"],
      {
        cwd: repoRoot,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    frontendProcess = child;
    frontendStarted = true;

    wireProcessLogs(child, "frontend", () => {
      if (frontendProcess !== child) return;
      frontendProcess = null;
      frontendStarted = false;

      if (!shuttingDown) {
        log("manager", "frontend encerrou fora do fluxo esperado");
      }
    });

    log("manager", `frontend iniciado em http://127.0.0.1:${frontendPort}`);
  } finally {
    startingFrontend = false;
  }
}

async function restartApi(reason: string): Promise<void> {
  if (restartingApi) return;

  restartingApi = true;
  log("manager", `reiniciando api: ${reason}`);

  try {
    await stopApi();
    await startApi();
  } finally {
    restartingApi = false;
  }
}

async function ensureServicesStarted(): Promise<void> {
  await startApi();
  await startFrontend();
}

async function handleTunnelUrl(publicBaseUrl: string): Promise<void> {
  if (currentPublicBaseUrl === publicBaseUrl) return;

  const previousPublicBaseUrl = currentPublicBaseUrl;
  currentPublicBaseUrl = publicBaseUrl;

  await updateEnvValue("PUBLIC_BASE_URL", publicBaseUrl);
  log("manager", `PUBLIC_BASE_URL atualizado para ${publicBaseUrl}`);

  if (syncWebhook) {
    const webhookUrl = `${publicBaseUrl}/api/webhook/alby`;
    await updateEnvValue("WEBHOOK_URL", webhookUrl);
    log("manager", `WEBHOOK_URL atualizado para ${webhookUrl}`);
  }

  if (!apiStarted) {
    await startApi();
  } else {
    log(
      "manager",
      "api ja iniciada; mantendo processo atual para evitar conflito de porta durante atualizacao de URL publica",
    );
  }

  if (previousPublicBaseUrl !== publicBaseUrl) {
    await notifyPublicUrlChange(publicBaseUrl, previousPublicBaseUrl);
  }
}

async function launchTunnel(): Promise<void> {
  const cloudflaredCommand = await resolveCloudflaredCommand();
  const tunnelTargetUrl = getTunnelTargetUrl();
  const useNamedTunnel = Boolean(configuredTunnelToken);
  const tunnelArgs = useNamedTunnel
    ? ["tunnel", "--no-autoupdate", "run", "--token", configuredTunnelToken as string]
    : ["tunnel", "--no-autoupdate", "--url", tunnelTargetUrl];
  const child = spawn(
    cloudflaredCommand,
    tunnelArgs,
    {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  tunnelProcess = child;
  if (useNamedTunnel) {
    log("manager", "named tunnel iniciando com token");
    if (configuredPublicBaseUrl) {
      await handleTunnelUrl(configuredPublicBaseUrl);
    } else {
      log(
        "manager",
        "TUNNEL_PUBLIC_BASE_URL ausente; configure para manter PUBLIC_BASE_URL apontando para o dominio do named tunnel",
      );
    }
  } else {
    log("manager", `quick tunnel iniciando em ${tunnelTargetUrl}`);
  }

  const onLine = (line: string) => {
    log("tunnel", line);

    const matchedUrl = line.match(tunnelUrlPattern)?.[0];
    if (!matchedUrl) return;

    void handleTunnelUrl(matchedUrl).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log("manager", `falha ao aplicar URL publica: ${message}`);
    });
  };

  readLines(child.stdout, onLine);
  readLines(child.stderr, onLine);

  child.on("error", (error) => {
    log("manager", `falha ao iniciar tunnel: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (tunnelProcess === child) {
      tunnelProcess = null;
    }

    log("manager", `tunnel saiu (code=${code ?? "null"}, signal=${signal ?? "null"})`);

    if (shuttingDown) return;

    setTimeout(() => {
      void launchTunnel().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log("manager", `falha ao relancar tunnel: ${message}`);
        process.exitCode = 1;
      });
    }, 2000);
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log("manager", `encerrando (${signal})`);
  await stopChild(tunnelProcess, "tunnel");
  await stopFrontend();
  await stopApi();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  log("manager", `erro nao tratado: ${error.message}`);
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (error) => {
  const message = error instanceof Error ? error.message : String(error);
  log("manager", `promise rejeitada: ${message}`);
  void shutdown("unhandledRejection");
});

void resolveNotificationConfig()
  .then(async (notificationConfig) => {
    await resolveRuntimePorts();
    log(
      "manager",
      `syncWebhook=${syncWebhook ? "on" : "off"} notifyWebhook=${notificationConfig.webhookUrl ? "on" : "off"} telegram=${notificationConfig.telegramBotToken && notificationConfig.telegramChatId ? "on" : "off"} apiPort=${apiPort} frontendPort=${frontendPort} tunnelMode=${configuredTunnelToken ? "named" : "quick"} tunnelTarget=${getTunnelTargetUrl()}`,
    );

    return ensureServicesStarted().then(() => launchTunnel());
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log("manager", `falha ao iniciar orquestrador: ${message}`);
    process.exit(1);
  });
