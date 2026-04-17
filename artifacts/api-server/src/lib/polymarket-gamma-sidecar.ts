import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

let resolvedPythonPromise: Promise<string | null> | null = null;
let resolvedScriptPromise: Promise<string | null> | null = null;
let sidecarAvailabilityWarned = false;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveSidecarPython(): Promise<string | null> {
  if (resolvedPythonPromise) return resolvedPythonPromise;

  resolvedPythonPromise = (async () => {
    const configured = process.env.POLYMARKET_GAMMA_PYTHON?.trim();
    if (configured && await fileExists(configured)) return configured;

    const candidates = [
      path.join(process.cwd(), ".runtime", "polymarket-gamma-venv", "bin", "python"),
      path.resolve(process.cwd(), "..", "..", ".runtime", "polymarket-gamma-venv", "bin", "python"),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }

    return null;
  })();

  return resolvedPythonPromise;
}

async function resolveSidecarScript(): Promise<string | null> {
  if (resolvedScriptPromise) return resolvedScriptPromise;

  resolvedScriptPromise = (async () => {
    const candidates = [
      path.join(process.cwd(), "scripts", "polymarket_gamma_sidecar.py"),
      path.resolve(process.cwd(), "..", "..", "scripts", "polymarket_gamma_sidecar.py"),
    ];

    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }

    return null;
  })();

  return resolvedScriptPromise;
}

async function runGammaSidecar(args: string[]): Promise<unknown | null> {
  const python = await resolveSidecarPython();
  const script = await resolveSidecarScript();
  if (!python || !script) {
    if (!sidecarAvailabilityWarned) {
      sidecarAvailabilityWarned = true;
      logger.warn("Polymarket Gamma sidecar unavailable; falling back to direct HTTP fetches");
    }
    return null;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      python,
      [script, ...args],
      {
        cwd: process.cwd(),
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    if (stderr.trim()) {
      logger.warn({ stderr, args }, "Polymarket Gamma sidecar emitted stderr");
    }

    return JSON.parse(stdout) as unknown;
  } catch (err) {
    logger.warn({ err, args }, "Polymarket Gamma sidecar request failed");
    return null;
  }
}

export async function fetchGammaSidecarSports(): Promise<unknown[] | null> {
  const payload = await runGammaSidecar(["sports"]);
  return Array.isArray(payload) ? payload : null;
}

export async function fetchGammaSidecarTeams(): Promise<unknown[] | null> {
  const payload = await runGammaSidecar(["teams"]);
  return Array.isArray(payload) ? payload : null;
}

export async function fetchGammaSidecarEventBySlug(slug: string): Promise<unknown | null> {
  if (!slug.trim()) return null;
  return runGammaSidecar(["event-by-slug", slug]);
}
