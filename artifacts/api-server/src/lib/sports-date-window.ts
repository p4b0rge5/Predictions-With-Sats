export const SPORTS_LOOKBACK_DAYS = 1;
export const SPORTS_FUTURE_DAYS = 2;

export function getSportsDateWindowStrings(nowMs = Date.now()): string[] {
  const base = new Date(nowMs);
  base.setUTCHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let offset = -SPORTS_LOOKBACK_DAYS; offset < SPORTS_FUTURE_DAYS; offset += 1) {
    const next = new Date(base);
    next.setUTCDate(base.getUTCDate() + offset);
    dates.push(next.toISOString().slice(0, 10));
  }

  return dates;
}

