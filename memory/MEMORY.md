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

### Dev Server (this machine)
- Ubuntu 24.04 VM on Aleph Cloud, full root access
- Public FQDN: `priority-swing-fork-monkey.2n6.me`
- PostgreSQL 16, Node 20, pnpm 10, Caddy 2.8
- Runs `pwsats-api` (:3001) + `pwsats-web` (:3002) + Caddy (:443)
- Caddy serves `pwsats.com` (with `/app` base path) + `.2n6.me` agent

### Production Server
- Debian 12 VM on Aleph Cloud
- IP: `37.114.37.140`, SSH port `24003`
- IPv6: `2a0e:97c0:3e3:274:3:d6e:5c17:e5a1`
- SSH key: `/root/.ssh/id_ed25519_deployment`
- Domain: `pwsats.com` → A record `37.114.37.140` + AAAA `2a0e:97c0:3e3:274:3:d6e:5c17:e5a1` (Njalla DNS)
- **Let's Encrypt cert** obtained 2026-05-09, expires 2026-08-07. Automatic HTTP-01 challenge.
- PostgreSQL 15, Node 20, pnpm 10.33.4, Caddy 2.6.2
- Caddy serves `pwsats.com` only (single site block, `BASE_PATH=/`)
- **No agent UI on production** — production is PWSats-only

### Database (both dev and prod)
- PostgreSQL database `pwsats_db`
- User `pwsats`, password `p4borge55` (app user used in `.env`'s `DATABASE_URL`)
- User `p4borge55`, same password (owner, for dumps and GRANT operations)
- **IMPORTANT:** After importing a dump, run `GRANT ALL ON ALL TABLES/SEQUENCES TO pwsats` — dump creates tables as `postgres`
- Drizzle ORM schema: 10 tables (bets, market_windows, price_snapshots, sport_bets, sport_markets, sport_poly_bets, sport_poly_markets, weather_bets, weather_markets, webhook_events)

### .env Location
- `.env` at repo root: `/opt/Predictions-With-Sats/.env`
- `DATABASE_URL="postgresql://pwsats:p4borge55@localhost:5432/pwsats_db"`
- `EnvironmentFile=/opt/Predictions-With-Sats/.env` in systemd unit (not in `artifacts/`)

### Services (production)
| Service | Port | Type |
|---------|------|------|
| `pwsats-api` | 3001 | API server (Node.js, Express/Hono) |
| `pwsats-web` | 3002 | Vite preview server (React SPA) — **backup only** |
| `caddy` | 80, 443 | Reverse proxy (HTTPS), serves static SPA directly |

### Caddy Routing (production — single site block, BASE_PATH=/)
**pwsats.com block:**
1. `handle /api*` → `reverse_proxy localhost:3001` (API routes)
2. `handle { root ...; try_files {path} /index.html; file_server }` (SPA static files)

**Why handle blocks:** Caddy evaluates `handle` blocks in order — first match wins. Without `handle`, `file_server` + `try_files` intercepts `/api/*` and serves `index.html` instead of proxying to the API.

### BASE_PATH for Web Build (CRITICAL)
- **Production:** `BASE_PATH=/` (serve at domain root, no prefix)
- **Dev machine:** `BASE_PATH=/app` (serve at `/app` subpath)
- When building: `BASE_PATH=/ pnpm --filter @workspace/predictions-with-sats-web run build`

---

## Deployment

### Deployment — Two Scripts
- `scripts/deploy-to-production.sh` — Safe deploy: `git pull` + `drizzle-kit push` + build + restart. **Never imports dump.** Production data preserved.
- `scripts/deploy-to-production.sh quick` — Same but skips dependency installation (faster)
- `scripts/restore-dump-to-production.sh` — **DANGEROUS**: Overwrites entire production DB from dump. Requires typing `DESTROY` to confirm. For disaster recovery only.

### Env vars (set in shell or .env.deploy)
```bash
PROD_HOST=37.114.37.140
PROD_PORT=24003
PROD_SSH_KEY=/root/.ssh/id_ed25519_deployment
DOMAIN=pwsats.com
DB_USER=pwsats
DB_PASSWORD=p4borge55
DB_NAME=pwsats_db
GITHUB_CLONE_URL="https://p4b0rge5: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@github.com/p4b0rge5/Predictions-With-Sats.git"
```
```bash
# Normal deploy (safe — does NOT touch production data):
./scripts/deploy-to-production.sh          # full
./scripts/deploy-to-production.sh quick   # skip deps

# Manual dump restore (DANGEROUS — overwrites ALL prod data):
./scripts/restore-dump-to-production.sh
```

**Database strategy:** The deploy script NEVER imports `db/dump.sql` into production. Schema migrations are applied via `drizzle-kit push` (adds/alters columns without dropping data). Production bets, markets, and user data are preserved across deploys. The dump stays in the repo as a backup for disaster recovery only.

### Key Differences: Dev vs Production
| Aspect | Dev | Production |
|--------|-----|------------|
| OS | Ubuntu 24.04 | Debian 12 |
| PostgreSQL | 16 | 15 |
| BASE_PATH | `/app` | `/` |
| Caddy | Two site blocks (pwsats + .2n6.me) | Single block (pwsats only) |
| Cert | Manual cert files + auto_https off | Automatic Let's Encrypt |
| Extra services | baal-agent (:8080) | None |

### Deployment Lessons Learned (2026-05-09)
1. **DNS AAAA must be updated** — Let's Encrypt tries IPv6 first; stale AAAA = cert failure
2. **Need both users** — `p4borge55` (owner for dumps) and `pwsats` (app user in .env)
3. **GRANT after import** — dump creates tables as `postgres`; `pwsats` gets `permission denied` without GRANT
4. **Stale Caddy process** — manual `caddy run` as root leaves stale port 2019 binding → `pkill -9 caddy` before `systemctl start`
5. **Cert ownership** — manual `caddy run` as root saves certs to `/root/.local/share/caddy/` → systemd (user `caddy`) can't read them. Clear both cert dirs before restart.
6. **handle blocks required** — can't mix `reverse_proxy` + `try_files` in same Caddy block

### Full deploy skill
See: `skills/deploy-pwsats-production/SKILL.md`

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
- Token stored in `.env` as `COINOS_JWT_TOKEN`

---

## Repo
- Remote: `https://github.com/p4borge55/Predictions-With-Sats.git`
- Branch: `main`
- Monorepo with pnpm workspaces:
  - `packages/database` — Drizzle schema + migrations
  - `artifacts/predictions-with-sats-api` — Backend (Express + Node.js)
  - `artifacts/predictions-with-sats-web` — Frontend (React + Vite)
  - `artifacts/mockup-sandbox` — UI mockup (dev only)
- Scripts: `scripts/deploy-to-production.sh` (automated remote deploy), `scripts/build-deploy.sh` (local rebuild + restart)
