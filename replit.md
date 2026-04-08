# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## UI Conventions — Prediction Card Layout

All prediction cards (Crypto, Sports, Weather) follow the same vertical order:

1. **Header** — asset/city/match identity, kickoff/date, status badge
2. **Market question / teams** — what the user is predicting
3. **Bet buttons** — BET UP/DOWN, HOME/DRAW/AWAY, BET YES/NO (shown only on open markets)
4. **Pool bar** — `"X% SIDE_A | Pool: N sats | Y% SIDE_B"` row + colored bar below (shown only on open markets, never on settled/results cards)
5. **Fee footnote** — e.g. "2% house fee · settled automatically at full time"

**Pool bar layout (standard)**
```
{X}% HOME/UP/YES    Pool: N sats    {Y}% AWAY/DOWN/NO
[========= colored bar =========]
         {Z}% DRAW  ← Football only (hasDraw=true), centered below bar
```
- Empty pool defaults to equal split (50/50 for NBA, 33.3% for Football) — always at FULL color, never dimmed
- Pool bar is NEVER shown on finished/settled/results cards
- Do NOT add "2% house fee" or similar footnotes to prediction cards

## Sports — Multi-sport Architecture

Sports category supports multiple sports via `SportDef` in `sports.tsx`:
- **Football** (Soccer): `sport: "Soccer"`, `hasDraw: true`, green cards, 3-column buttons (HOME/DRAW/AWAY)
- **NBA** (Basketball): `sport: "Basketball"`, `hasDraw: false`, orange cards, 2-column buttons (HOME/AWAY)
- **NFL** (American Football): `sport: "American Football"`, `hasDraw: false`, indigo cards, 2-column buttons (HOME/AWAY)

**Backend libs:**
- `lib/sports.ts` — Football via `v3.football.api-sports.io` (IDs without namespace)
- `lib/nba.ts` — Basketball via `v1.basketball.api-sports.io` (IDs prefixed `nba_`)
- `lib/nfl.ts` — American Football via `v1.american-football.api-sports.io` (IDs prefixed `nfl_`)
- `routes/sports.ts` — Combines all three, enriches with market pool data from DB; returns `nflSuspended` field
- `lib/sports-pollers.ts` — Settlement uses per-sport `getExpectedDurationMs()` + force-refresh + direct API fallback

**Event IDs are namespaced:** `nba_<id>` for basketball, `nfl_<id>` for NFL, no prefix for soccer.

**NBA league IDs:** 12 = Regular Season, 13 = Playoffs
**NFL league IDs:** 1 = NFL Regular Season, 2 = NFL Playoffs
**NFL off-season guard:** April–July → `getNflEvents()` returns empty immediately without API calls (no games scheduled).
**NFL cache TTL:** 3 hours (weekly games; ~24 req/day vs 100/day budget).
**NFL expected game duration:** 240 min (4h with OT) — used by settlement poller `getExpectedDurationMs("nfl_...")`.

**`SportDef.suspendedKey`:** Each sport declares which field in the API response holds its suspended state (`"suspended"` for soccer, `"nbaSuspended"` for NBA, `"nflSuspended"` for NFL). `isSuspended` in the frontend reads this generically.

## Settlement Standard — ALL categories and subcategories

**MANDATORY for every new betting category (Sports, Crypto, Weather, etc.).**

### The Problem
API caches have a 1-hour TTL. A match/event can finish AFTER the last cache refresh, so the settlement poller finds the event still "live" in the stale cache and never settles it.

### Required Pattern — three layers of defence

**Layer 1 — Force-refresh cache when markets are overdue**
Every data source (`getSportsEvents`, `getNbaEvents`, etc.) MUST accept a `forceRefresh: boolean` parameter.
When `forceRefresh=true` AND the cache is older than a minimum cooldown (10 min), bypass the TTL and re-fetch from the API.
```typescript
export async function getMyEvents(forceRefresh = false) {
  const cacheAge = Date.now() - cache.fetchedAt;
  const canForce = forceRefresh && cacheAge >= FORCE_REFRESH_COOLDOWN_MS; // 10 min
  if (!canForce && cacheAge < CACHE_TTL_MS) return cachedData;
  // ... fresh API fetch
}
```

**Layer 2 — Settlement poller detects overdue markets and triggers force-refresh**
In `pollSportSettlement()` (or equivalent poller for the new category):
```typescript
const MATCH_EXPECTED_DURATION_MS = 110 * 60 * 1000; // 110 min for soccer; adjust per sport

const hasPastDue = openMarkets.some(
  (m) => Date.now() - new Date(m.startsAt).getTime() > MATCH_EXPECTED_DURATION_MS
);
const events = await getMyEvents(hasPastDue); // passes forceRefresh=true when needed
```

**Layer 3 — Direct API lookup fallback per event**
If an event is STILL not in the finished list after the force-refresh, and the market is overdue, do a **direct single-event API call** (cheaper, more targeted):
```typescript
if (!event || event.status !== "finished") {
  const isOverdue = Date.now() - kickoffMs > MATCH_EXPECTED_DURATION_MS;
  if (isOverdue) {
    const fetched = await fetchEventById(market.eventId); // direct API call by ID
    if (fetched) event = fetched;
  }
}
```
Each sport/category data lib MUST expose a `fetchEventById(id)` function for this fallback.

### Expected duration constants by category
| Category | Constant | Reason |
|----------|----------|--------|
| Soccer   | 110 min  | 90 min play + ~20 min stoppage/extra time |
| NBA      | 150 min  | ~2.5h incl. OT and breaks |
| Weather  | use exact window close time | settled at midnight |
| Crypto   | 5 min    | always the exact window size |

### Adding a new sport/category — checklist
1. ☑ Data lib (`lib/my-sport.ts`): add `forceRefresh` param to main fetch function + export `fetchEventById`
2. ☑ Settlement poller (`lib/sports-pollers.ts` or new file): compute `hasPastDue`, pass `forceRefresh`, call `fetchEventById` as fallback
3. ☑ Log verbose settlement steps (checking, skipping, settling) so issues are diagnosable in logs
4. ☑ API budget: force-refresh cooldown ≥ 10 min + individual lookup only when overdue (never spam)

## My Bets — per-subcategory isolation (standard pattern)

**Rule:** Every subcategory (sport, asset, city) MUST use its own isolated storage bucket for My Bets. Never share a bucket across subcategories.

**Sports implementation** (use this pattern for all future sports):
- Storage key: `lightning_bet_sport_<sportKey>_hashes_v1` (auto-generated by `sportStorageKey()`)
- Functions in `my-bet-widget.tsx`: `saveSportBetHashForKey(sportKey, hash)`, `getSportBetHashesForKey(sportKey)`, `removeSportBetHashForKey(sportKey, hash)`
- `SportBetModal` receives `sportKey: string` prop → saves to the correct bucket
- Main page: `useEffect(() => setBetHashes(getSportBetHashesForKey(activeSport)), [activeSport])` — refreshes My Bets on sport change
- `onDismiss`: calls `removeSportBetHashForKey(activeSport, h)` and refreshes
- `onClose` of modal: refreshes with `getSportBetHashesForKey(activeSport)`

Adding a **new sport** (e.g. tennis): zero changes to `my-bet-widget.tsx` — just pass the sport key through.

## My Bets — standard for all categories

Every category page (Crypto, Sports, Weather) must include a `MyBetsList` section below the market cards, using `getBetHashes` / `removeBetHash` / `saveBetHash` from `@/components/my-bet-widget`.
- Save hash: call `saveBetHash(paymentHash)` when payment is confirmed (status `"paid"` in polling, or `onSuccess` in mutation)
- Refresh list when modal closes: `setBetHashes(getBetHashes())`
- The widget is self-contained; returns `null` if there are no hashes to show
