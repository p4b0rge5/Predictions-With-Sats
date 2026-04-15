type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  secure?: boolean;
};

function firstHeaderValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;

  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function isLocalHost(value: string): boolean {
  return /(^|:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(value) ||
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(value);
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getPublicBaseUrl(req: RequestLike): string {
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) ??
    firstHeaderValue(req.headers.host) ??
    "localhost";

  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) ??
    (req.secure ? "https" : "http");

  if (host && !isLocalHost(host)) {
    return `${proto}://${host}`;
  }

  const configuredPublicBase = normalizeBaseUrl(process.env["PUBLIC_BASE_URL"]);
  if (configuredPublicBase) return configuredPublicBase;

  const webhookBase = normalizeBaseUrl(process.env["WEBHOOK_URL"]);
  if (webhookBase) return webhookBase;

  return `${proto}://${host}`;
}
