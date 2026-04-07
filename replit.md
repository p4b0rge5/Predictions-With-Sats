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
         {Z}% DRAW  ← Sports only, centered below bar
```
- Empty pool defaults to equal split (50/50 or 33.3%) — always rendered at FULL color, never dimmed
- Pool bar is NEVER shown on finished/settled/results cards
- Do NOT add "2% house fee" or similar footnotes to prediction cards — it does not exist on the Bitcoin reference screen

## My Bets — standard for all categories

Every category page (Crypto, Sports, Weather) must include a `MyBetsList` section below the market cards, using `getBetHashes` / `removeBetHash` / `saveBetHash` from `@/components/my-bet-widget`.
- Save hash: call `saveBetHash(paymentHash)` when payment is confirmed (status `"paid"` in polling, or `onSuccess` in mutation)
- Refresh list when modal closes: `setBetHashes(getBetHashes())`
- The widget is self-contained; returns `null` if there are no hashes to show
