# Predictions-With-Sats — Memory

## CRITICAL: Git Commit After Every Code Change

**Rule:** After finishing ANY code changes to the Predictions-With-Sats project, immediately run:
```
cd /opt/baal-agent/workspace/Predictions-With-Sats && git add -A && git commit -m "descriptive message"
```

The post-commit hook at `.git/hooks/post-commit` automatically:
1. Dumps PostgreSQL database to `db/dump.sql`
2. Amends the dump into the commit
3. Force-pushes to `origin main`

**Never** report changes as "done" without committing. The hook does the push — I just need to trigger the commit.

A pre-commit hook at `.git/hooks/pre-commit` syncs this MEMORY.md from the workspace into the repo (`memory/MEMORY.md`) before every commit, so the repo always has the latest version.

---

## Infrastructure

### Server
- Debian 12 VM on Aleph Cloud, full root access
- Public FQDN: `priority-swing-fork-monkey.2n6.me`
- Caddy reverse proxy on port 443 (managed, `/etc/caddy/Caddyfile` overwritten on redeploy)
- Custom Caddy snippets in `/etc/caddy/conf.d/*.caddy` survive redeploys

### Database
- PostgreSQL 16, database `pwsats_db`, user `pwsats`, password `p4borge55`
- Drizzle ORM schema: 10 tables
- `.env` at `artifacts/predictions-with-sats-api/.env` with DB, Coinos JWT, Alby webhook, API keys

### Services
| Service | Port | Type |
|---------|------|------|
| `pwsats-api` | 3001 | API server (Hono + Node.js) |
| `pwsats-web` | 3002 | Vite preview server (React SPA) |
| `caddy` | 443 | Reverse proxy (HTTPS) |

### Caddy Routing
- `/pwsats/*` → web frontend (:3002) — **no strip**, Vite expects the prefix
- `/pwsats/api/*` → API server (:3001) — **strips prefix**
- `/` → baal-agent (:8080) — default fallback

### BASE_PATH for Web Build (CRITICAL)
- `BASE_PATH=/pwsats` must be set when running `vite build` for the web frontend
- Without it, the build produces `/assets/...` paths instead of `/pwsats/assets/...`
- This causes a **blank white page** because JS/CSS assets 404
- The systemd service `pwsats-web` has `Environment=BASE_PATH=/pwsats` (for preview)
- `scripts/build-deploy.sh` sets `BASE_PATH=/pwsats` before the web build (line 75)
- When building manually: `BASE_PATH=/pwsats pnpm --filter @workspace/predictions-with-sats-web run build`

---

## PWSats Deployment Fixes (2026-05-04)

### Root Cause: Vite Preview SPA Routing with BASE_PATH
- The Vite preview server with `base: "/pwsats"` expects requests WITH the `/pwsats` prefix
- Do NOT use `uri strip_prefix /pwsats` for the web frontend handler
- Caddy `handle_path` with `strip_prefix` was breaking this because it sent `/` to Vite instead of `/pwsats/`
- Build must be done with `BASE_PATH=/pwsats` to get correct asset paths in HTML
- The systemd service `pwsats-web` includes `Environment=BASE_PATH=/pwsats`

### Key Finding
- Vite preview server with `base: "/pwsats"` serves index.html at `/pwsats/` (200)
- Without prefix, `/` redirects 302 to `/pwsats` (built-in Vite behavior)

---

## My Bets Fix (2026-05-04)

### Issue: hockey and basketball bets not showing in My Bets
- `my-bets.tsx` had `SPORT_KEYS` missing `hockey` and `basketball`
- `my-bet-widget.tsx` `removeStoredBetHashEverywhere()` also missing them
- `sports.tsx` already had full `SportKey` type with all 8 sports
- Result: bets placed on hockey/basketball were saved to localStorage but never read back

### Fix Applied
- Added `{ key: "hockey", label: "Hockey" }` and `{ key: "basketball", label: "Basketball" }` to `SPORT_KEYS` in `my-bets.tsx`
- Updated `SportKey` type in `my-bets.tsx` to include `hockey | basketball`
- Updated sport key loop in `removeStoredBetHashEverywhere()` in `my-bet-widget.tsx`

### Payment Flow Architecture
- `saveSportBetHashForKey(sportKey, paymentHash)` called in `sports.tsx:1035` immediately after invoice creation
- Also redundantly saved on line 970 when poller detects `paid`/`won` status
- Storage key pattern: `predictions_with_sats_sport_${sportKey}_hashes_v1`
- My Bets page reads from localStorage only — no backend query for bet list
- If localStorage cleared or different device, bets won't appear (use BetRecoveryForm with payment hash)

---

## Git Hooks Architecture (2026-05-04)

### pre-commit (`hooks/pre-commit`, versioned)
- Syncs `MEMORY.md` and `USER.md` from `/opt/baal-agent/workspace/memory/` into `memory/` in the repo
- Ensures the repo always has the latest memory state

### post-commit (`hooks/post-commit`, versioned)
- Dumps PostgreSQL to `db/dump.sql`
- Amends the dump if changed
- Force-pushes to `origin main`
- Uses lock file to prevent recursion

### Installation
```bash
cp hooks/pre-commit .git/hooks/pre-commit
cp hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/{pre-commit,post-commit}
```

---

## Coinos Integration
- JWT token is 27 days old (issued 2026-04-06), `daysUntilStale: 0`, `expired: false` — may need refreshing soon
- Token stored in `.env` as `COINOS_JWT`

---

## Repo
- Remote: `https://github.com/p4b0rge55/Predictions-With-Sats.git`
- Branch: `main`
- Monorepo with pnpm workspaces:
  - `packages/database` — Drizzle schema + migrations
  - `artifacts/predictions-with-sats-api` — Backend (Hono + Node.js)
  - `artifacts/predictions-with-sats-web` — Frontend (React + Vite)
  - `artifacts/mockup-sandbox` — UI mockup (dev only)
