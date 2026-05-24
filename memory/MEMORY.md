# MEMORY.md

## Project: Predictions With Sats (pwsats-local)
- **Repo**: https://github.com/p4b0rge5/Predictions-With-Sats
- **NO local clone on this agent server.** Repository stays only on dev server and prod. Never clone on this agent VM.
- **Current HEAD**: `b4e16d14` (fix: add ws dependency to api-server package.json) — reverted from fb8d4ecc on 2026-05-18

## Known Issues & Fixes

### Polymarket "resolvedBy" without "closed: true" (2026-05-24)
- Some leagues (Brasileirão B, `bra2`) have `resolvedBy` set on markets but `closed: false` in the API response. No `score` field either.
- Fix in `polymarket-sports.ts` line 572: `const isClosed = raw.closed === true || raw.closed === "true" || !!asString(raw.resolvedBy)` — treat any non-empty `resolvedBy` as resolved.
- Also added `resolvedBy?: unknown` to `PolymarketMarketLike` interface.
- Settlement now works for these leagues via `outcomePrices` convergence (winner = highest price).

## Server Access

### Dev Server
- **Host**: `root@2602:294:0:66d:3:fa3e:5395:3001` (Aleph Cloud, IPv6)
- **Hostname**: `7i7fhfjqb6ejin5g6xqjelkezp3u7ymgeceicsynkleiadf7g3ma`
- **SSH key**: `/opt/baal-agent/workspace/.ssh/id_ed25519`
- **Caddy domain**: `when-verb-torch-gas.2n6.me` (import `/etc/caddy/conf.d/*.caddy`)
- **Caddy snippets**: `/etc/caddy/conf.d/pwsats.caddy` (handles `/api/*`, `/app/*`, `/assets/*`)
- **Project path**: `/opt/baal-agent/workspace/pwsats-local`
- **PostgreSQL**: `postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev`
- **Services**: `pwsats-api` (port 3001). No separate web service — Caddy serves static files directly.

### Prod Server
- **Host**: `root@37.114.37.140` port **24003** (OVH)
- **Hostname**: `bvxfyf7fuoufzgtih7zpxgowawty7oi5i5amg6hdrj4hilk3y7gq`
- **Domain**: `pwsats.com`
- **SSH key**: `~/.ssh/prd_key` on the **dev server** (NOT accessible from agent VM directly)
- **Access**: Must SSH from dev → prod. No direct access from agent VM.
  ```bash
  # Step 1: Agent VM → Dev server
  ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001
  # Step 2: Dev server → Prod server
  ssh -i ~/.ssh/prd_key -p 24003 root@37.114.37.140
  ```
- **Project path**: `/opt/Predictions-With-Sats`
- **Caddy**: Self-managed at `/etc/caddy/Caddyfile` (serves `pwsats.com`, proxies `/api*` → localhost:3001)
- **PostgreSQL**: `postgresql://pwsats:p4borge55@localhost:5432/pwsats_db`
- **Services**: `pwsats-api` (port 3001), `pwsats-web` (vite preview port 3002), `caddy`
- **Note**: Prod runs `NODE_ENV=development` per `.env`.

## Deployment Pattern
### Dev server (from agent VM):
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 'cd /opt/baal-agent/workspace/pwsats-local && git pull origin main && cd artifacts/api-server && pnpm build && cd ../predictions-with-sats-web && pnpm build && systemctl restart pwsats-api'
```
> Frontend is served by Caddy from `dist/public` — no service restart needed for frontend-only changes.

### Prod server (via jump through dev):
```bash
# From agent VM → dev → prod:
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    cd /opt/Predictions-With-Sats && \
    git pull origin main && \
    cd artifacts/api-server && pnpm build && \
    cd ../predictions-with-sats-web && pnpm build && \
    systemctl restart pwsats-api && systemctl restart pwsats-web"
'
```
- **pnpm install**: Only needed when new deps are added to package.json. Otherwise skip.

### DB migrations on prod:
Manual ALTER TABLE via psql or `pnpm --filter @workspace/db db:migrate deploy` if using Prisma migrations.

## Key Modules
### Sports WS Scores (`sports-ws-scores.ts`)
- Connects to `wss://sports-api.polymarket.com/ws` (changed from `ws-gateway.polymarket.com`)
- **BROKEN since ~May 2026**: Polymarket WS now only sends tennis data, not soccer/MLB/NHL
- Connects/disconnects repeatedly, receives 0-10 messages per connection (tennis only)
- Still kept running alongside ESPN fallback as insurance

### Poly Score Sync (`poly-score-sync.ts`) — ESPN fallback
- Created: 2026-05-18, committed `ac7e8630`
- Replaces unreliable Polymarket WS for non-tennis sports
- Uses `getEspnMultiSportEvents()` from `espn-multi.ts` for NBA, NHL, MLB
- Polls every 30 seconds, matches poly markets by team name + league
- Only updates **live or finished** games (skips `upcoming`)
- Fuzzy team name matching: handles "Cavaliers" ↔ "Cleveland Cavaliers"
- League mapping: "Basketball" ↔ "NBA"
- Logs: "Poly score sync: completed" (summary) and "Poly score sync: updated from ESPN" (per market)
- **Limitation**: Soccer NOT covered by ESPN multi-sport endpoint. Soccer scores not updated.

### Sports Pollers (`sports-pollers.ts`)
- Separate from WS scores — handles payment collection and settlement
- Runs on intervals: payment every 5s, settlement every 15min

### Settlement (`sports-settlement.ts`)
- Uses `isSettled` and `isLive` fields from Polymarket WS to trigger settlement
- Sets `settled_at` and `status = 'settled'` in DB

## Frontend Route Structure
- `/app/*` → SPA frontend (Caddy serves `dist/public/index.html`)
- `/api/*` → API server (Caddy reverse_proxy to localhost:3001)
- `/app/api/*` → API server (strip_prefix /app, reverse_proxy to localhost:3001)
- `/assets/*`, `/favicon.svg`, `/manifest.json`, `/opengraph.jpg` → Static files

## Known Issues
- Polymarket REST API returns 429 (rate limit) for some tag queries — use WS instead
- `sports-request-budget.ts` writes to `.runtime/` dir which may be on read-only FS on dev
- `COINOS_JWT_TOKEN` expired — needs refresh for winner payouts
- `ws` package must be explicitly installed in api-server deps (`pnpm add ws`) — transitive dep doesn't hoist properly on prod
- Poly markets have no native "live" status (only `open`/`settled`). Frontend `polyToSportEvent()` currently maps all open markets as `"upcoming"` regardless of whether scores are available.

## Today's Notes (2026-05-18)
- Fixed prod `.env` DATABASE_URL from `pwsats_dev` → `pwsats_db` (was pointing to non-existent database)
- Deployed fix for poly market LIVE status (commit 8c6ff72e) — reverted at user request (commit a3f2ef21)
- **Poly settlement fix (commit 28a893c2)**: Added upsert (`ON CONFLICT (external_market_id) DO UPDATE`) to `syncPolySportsMarkets` INSERT to prevent PK collision. Also fixed sequence desync with `setval`.
- **Manual settlements**: 4 markets deslisted/not resolving via Polymarket API settled manually: Nashville vs LAFC (home), Pumas vs Pachuca (home), Paranaense vs Flamengo (draw), Nashville vs DCU (unknown). No bets on any of these.
- Updated all SSH access documentation with verified details

## Communication Style
- User prefers concise, direct technical communication (Portuguese)
- Focus on what was done, what's working, what needs attention

## ⚠️ Critical Rules
1. **NÃO tome decisões sem consultar o usuário.** Sempre perguntar antes de implementar soluções, fazer deploy, ou mudar comportamento do app.
2. **Soluções devem usar nativamente a API da Polymarket.** Não usar fontes externas como ESPN, APIs de terceiros, ou qualquer serviço que não já seja utilizado no app. Se a API da Polymarket não fornece algo, reportar ao usuário em vez de criar workaround.
