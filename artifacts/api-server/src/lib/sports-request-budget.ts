import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SportsProvider =
  | "football"
  | "nba"
  | "nfl"
  | "mlb"
  | "mma"
  | "rugby";

interface BudgetState {
  day: string;
  usage: Partial<Record<SportsProvider, number>>;
}

const MAX_REQUESTS_PER_DAY = 100;
const stateFilePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.runtime/sports-request-budget.json",
);

let inMemoryState: BudgetState | null = null;
let lock: Promise<void> = Promise.resolve();

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeState(state: BudgetState | null | undefined): BudgetState {
  const day = currentUtcDay();
  if (!state || state.day !== day) {
    return { day, usage: {} };
  }
  return state;
}

async function loadState(): Promise<BudgetState> {
  if (inMemoryState) {
    inMemoryState = normalizeState(inMemoryState);
    return inMemoryState;
  }

  try {
    const raw = await readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as BudgetState;
    inMemoryState = normalizeState(parsed);
  } catch {
    inMemoryState = normalizeState(null);
  }

  return inMemoryState;
}

async function saveState(state: BudgetState): Promise<void> {
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  inMemoryState = state;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = lock;
  let release!: () => void;
  lock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function reserveSportsRequests(
  provider: SportsProvider,
  amount: number,
): Promise<{ allowed: boolean; used: number; remaining: number }> {
  return withLock(async () => {
    const state = await loadState();
    const used = state.usage[provider] ?? 0;

    if (used + amount > MAX_REQUESTS_PER_DAY) {
      return {
        allowed: false,
        used,
        remaining: Math.max(0, MAX_REQUESTS_PER_DAY - used),
      };
    }

    const nextState: BudgetState = {
      day: state.day,
      usage: {
        ...state.usage,
        [provider]: used + amount,
      },
    };

    await saveState(nextState);

    return {
      allowed: true,
      used: nextState.usage[provider] ?? 0,
      remaining: Math.max(0, MAX_REQUESTS_PER_DAY - (nextState.usage[provider] ?? 0)),
    };
  });
}

export async function getSportsRequestBudget(
  provider: SportsProvider,
): Promise<{ used: number; remaining: number }> {
  const state = await loadState();
  const used = state.usage[provider] ?? 0;
  return { used, remaining: Math.max(0, MAX_REQUESTS_PER_DAY - used) };
}
