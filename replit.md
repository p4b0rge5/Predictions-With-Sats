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
- `./scripts/start-services.sh start` — start API + frontend + tunnel in background
- `./scripts/start-services.sh restart` — restart all managed services
- `./scripts/start-services.sh status` — show whether the managed service manager is running
- `./scripts/start-services.sh logs` — tail the consolidated service log

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
{X}% HOME/YES     Pool: N sats     {Y}% AWAY/NO
[============= colored bar =============]
     {Z}% DRAW  ← Football/Rugby only (hasDraw=true), centered below bar
```
- Pool bar shows ONLY percentages + total pool sats. No individual sats in the bar labels.
- **Sats per outcome belong INSIDE the bet buttons** — every bet button must show a second line with `{n} sats in pool` (small, dim text), using `flex flex-col gap-0.5` on the button (`h-14`).
- This applies to ALL categories: Sports (HOME/DRAW/AWAY buttons), Weather (BET YES / BET NO buttons), Crypto (BET UP / BET DOWN buttons — already implemented).
- Never show per-outcome sats both in the button AND in the pool bar — buttons only.
- Empty pool defaults to equal split (50/50 for NBA, 33.3% for Football) — always at FULL color, never dimmed
- Pool bar is NEVER shown on finished/settled/results cards
- Do NOT add "2% house fee" or similar footnotes to prediction cards

## Sports — Multi-sport Architecture

Sports category supports multiple sports via `SportDef` in `sports.tsx`:
- **Football** (Soccer): `sport: "Soccer"`, `hasDraw: true`, green cards, 3-column buttons (HOME/DRAW/AWAY)
- **NBA** (Basketball): `sport: "Basketball"`, `hasDraw: false`, orange cards, 2-column buttons (HOME/AWAY)
- **NFL** (American Football): `sport: "American Football"`, `hasDraw: false`, indigo cards, 2-column buttons (HOME/AWAY)
- **MLB** (Baseball): `sport: "Baseball"`, `hasDraw: false`, red cards, 2-column buttons (HOME/AWAY). ⚠️ Free API plan blocked for 2026 season.
- **MMA**: `sport: "MMA"`, `hasDraw: false`, yellow cards, 2-column buttons (HOME/AWAY). Covers UFC, Bellator, ONE Championship, PFL.
- **Rugby**: `sport: "Rugby"`, `hasDraw: true`, emerald cards, 3-column buttons (HOME/DRAW/AWAY). Covers Six Nations, Rugby Championship, Premiership, Top 14, URC, Super Rugby. No off-season.

**Backend libs:**
- `lib/sports.ts` — Football via `v3.football.api-sports.io` (IDs without namespace)
- `lib/nba.ts` — Basketball via `v1.basketball.api-sports.io` (IDs prefixed `nba_`)
- `lib/nfl.ts` — American Football via `v1.american-football.api-sports.io` (IDs prefixed `nfl_`)
- `lib/mlb.ts` — Baseball via `v1.baseball.api-sports.io` (IDs prefixed `mlb_`); off-season guard Dec–Feb
- `lib/mma.ts` — MMA via `v1.mma.api-sports.io` (IDs prefixed `mma_`); 1h TTL; no off-season
- `lib/rugby.ts` — Rugby via `v1.rugby.api-sports.io` (IDs prefixed `rugby_`); 1h TTL; no off-season; hasDraw=true
- `routes/sports.ts` — accepts optional `?sport=<key>` to load only the active sport; enriches with market pool data from DB; returns `suspended` for the selected sport and legacy `*Suspended` flags for compatibility
- `lib/sports-pollers.ts` — Settlement uses per-sport `getExpectedDurationMs()` + force-refresh + direct API fallback; only loads sports that currently have open markets
- `lib/sports-request-budget.ts` — persistent UTC-day request budget tracker; hard-caps each sports provider at 100 external requests/day

**Event IDs are namespaced:** `nba_<id>` for basketball, `nfl_<id>` for NFL, no prefix for soccer.

**NBA league IDs:** 12 = Regular Season, 13 = Playoffs
**NFL league IDs:** 1 = NFL Regular Season, 2 = NFL Playoffs
**NFL off-season guard:** April–July → `getNflEvents()` returns empty immediately without API calls (no games scheduled).
**NFL cache TTL:** 3 hours (weekly games; ~24 req/day vs 100/day budget).
**NFL expected game duration:** 240 min (4h with OT) — used by settlement poller `getExpectedDurationMs("nfl_...")`.

**Sports request-budget rules:**
- Sports UI must fetch only the active subcategory: `/api/sports/events?sport=<sportKey>`
- Do not reintroduce aggregate all-sports fetches from the Sports page
- Provider loaders must reserve request budget before each external API call
- Concurrent refreshes for the same provider must share one in-flight promise instead of issuing duplicate API calls
- Settlement poller must only load providers that have open markets; never refresh unrelated sports just because one market is overdue

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

### New Sport Implementation — full touch list (ALWAYS follow in order)
Every new sport touches exactly these 4 files. Do them all in one session without prompting:
1. **`lib/<sport>.ts`** — create from scratch: API URL, key, types, status/outcome helpers, mapGame/mapFight, HTTP helper, hasErrors, off-season guard (if applicable), cache struct (TTL + error TTL + force-refresh cooldown + max-age), `get<Sport>Events(forceRefresh)`, `fetch<Sport>GameById(id)`
2. **`lib/sports-pollers.ts`** — import `{get<Sport>Events, fetch<Sport>GameById}`, add to `getExpectedDurationMs()` prefix chain, add to `Promise.all` in `pollSportSettlement`, add `is<Sport>` flag + fallback branch in direct-lookup chain, add to `allFinished` spread
3. **`routes/sports.ts`** — import `get<Sport>Events`, add to both `Promise.all` calls (GET /events + POST /bets), spread into `upcoming/finished`, add `<sport>Suspended` field in response
4. **`sports.tsx`** — add `"<sport>"` to `SportKey` union, add `SportDef` entry (key/label/icon/sportName/hasDraw/cardClass/resultCardClass/suspendedKey), create `<SPORT>_GUIDE_STEPS` + `<Sport>Guide` component, add to `data` state type, add branch in guide renderer IIFE
Also update `replit.md` Sport list and backend libs table.

## My Bets — per-subcategory isolation (standard pattern)

**Rule:** Every subcategory (sport, asset, city) MUST use its own isolated storage bucket for My Bets. Never share a bucket across subcategories.

**Sports implementation** (use this pattern for all future sports):
- Storage key: `predictions_with_sats_sport_<sportKey>_hashes_v1` (auto-generated by `sportStorageKey()`)
- Functions in `my-bet-widget.tsx`: `saveSportBetHashForKey(sportKey, hash)`, `getSportBetHashesForKey(sportKey)`, `removeSportBetHashForKey(sportKey, hash)`
- `SportBetModal` receives `sportKey: string` prop → saves to the correct bucket
- Main page: `useEffect(() => setBetHashes(getSportBetHashesForKey(activeSport)), [activeSport])` — refreshes My Bets on sport change
- `onDismiss`: calls `removeSportBetHashForKey(activeSport, h)` and refreshes
- `onClose` of modal: refreshes with `getSportBetHashesForKey(activeSport)`

Adding a **new sport** (e.g. tennis): zero changes to `my-bet-widget.tsx` — just pass the sport key through.

## My Bets — standard for all categories

Every category page (Crypto, Sports, Weather) must expose the same local tab structure:
- `Markets`
- `Guide`
- `My Bets`
- `Results`

This order is mandatory. If one category changes, the same tab adjustment must be applied to the others unless there is an explicit product decision to diverge.

`My Bets` must remain available in two places:
- Local to the category/subcategory page
- Global in the header (`/my-bets`)

Implementation rules:
- Crypto: use `getBetHashesForAsset()` / `removeBetHashForAsset()` / `saveBetHashForAsset()`
- Sports: use `getSportBetHashesForKey()` / `removeSportBetHashForKey()` / `saveSportBetHashForKey()`
- Weather: use `getWeatherBetHashes()` / `removeWeatherBetHash()` / `saveWeatherBetHash()`
- `Results` behavior is category-specific:
  Crypto shows settled window history, Weather shows `status === "settled"` markets, Sports shows finished events from the external sports provider
- After an item leaves `Markets`, it should appear in `Results` immediately with its current lifecycle status (`live`, `settling`, `pending settlement`, etc.), even before final resolution
- In Sports, winner/score in `Results` comes from the provider outcome (`ev.outcome`, `homeScore`, `awayScore`); local settlement metadata is supplementary only
- Never render "settlement pending" messaging inside Sports result cards; if a local market is already settled, show only the settled badge/timestamp as extra metadata
- Refresh the local `My Bets` view when the bet modal closes or a bet is dismissed
- Empty states should stay inside the `My Bets` tab, not below market cards

## Card styling parity — mobile and desktop

Card surfaces and list spacing must stay visually consistent between mobile and desktop across Crypto, Sports, Weather, History and Global My Bets.

Implementation rules:
- Do not apply tinted backgrounds only on one breakpoint; if a card uses a tinted surface on mobile, desktop must keep the same tint family and visual separation
- Prefer shared utility classes for card tint and card spacing instead of page-specific `space-y-*` values spread across files
- Card lists should use the shared stack/grid spacing utilities so desktop keeps visible separation between cards, not compressed rows
- When adjusting card spacing or tint in one category, review and apply the same pattern to the parallel category pages unless there is an explicit reason to diverge
- Card tint intensity should follow the softer Sports Results standard across the app; adjust opacity/shadow only, not the hue mapping for each category
- This applies to `My Bets` cards too: crypto bet widgets, sport bet status cards and weather bet status cards must use the same global tint treatment as market/result cards

# test line
