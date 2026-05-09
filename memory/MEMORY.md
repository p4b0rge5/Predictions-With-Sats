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
- **New domain**: `pwsats.com` → AAAA record `2a01:240:ad00:2502:3:aafb:816d:c791` (IPv6-only, Njalla DNS)
- **Let's Encrypt cert** for `pwsats.com` obtained 2026-05-09, expires 2026-08-07. Manual DNS challenge only.
- Cert files: `/etc/letsencrypt/live/pwsats.com/` — owned `root:ssl-cert`, caddy user in `ssl-cert` group
- Caddy reverse proxy on port 443 — **Caddyfile rewritten** with two site blocks (one per domain, each with its own TLS cert). Will be overwritten on redeploy!
- Old SSH tunnel to `37.114.37.140:24001` (port 8081) has been **removed** — no longer needed
- Custom Caddy snippets in `/etc/caddy/conf.d/*.caddy` (currently empty)

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

### Caddy Routing (two site blocks, auto_https off)
**pwsats.com block (order matters — Caddy evaluates handles top to bottom):**
1. `/` → `rewrite * /app` → Vite frontend (:3002) — **Landing page, clean URL**
2. `/app/api*` → `uri strip_prefix /app` → `/api/*` → API (:3001)
3. `/api*` → API (:3001) — direct, for external calls
4. `/app*` → Vite frontend (:3002) — SPA

**.2n6.me block:**
- `reverse_proxy localhost:8080` — baal-agent (default)

### BASE_PATH for Web Build (CRITICAL)
- `BASE_PATH=/app` must be set when running `vite build` for the web frontend
- Without it, the build produces wrong paths and assets 404
- The systemd service `pwsats-web` has `Environment=BASE_PATH=/app`
- `scripts/build-deploy.sh` sets `BASE_PATH=/app` before the web build
- When building manually: `BASE_PATH=/app pnpm --filter @workspace/predictions-with-sats-web run build`

---

## PWSats Deployment Fixes (2026-05-04)

### Root Cause: Vite Preview SPA Routing with BASE_PATH
- The Vite preview server serves static files from `dist/public/` — paths are baked at build time
- No rewrite needed in Caddy when `BASE_PATH` matches the URL structure
- Build was changed from `BASE_PATH=/pwsats` → `BASE_PATH=/app` to clean up URLs

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
