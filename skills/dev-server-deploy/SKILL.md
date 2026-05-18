---
name: dev-server-deploy
description: >-
  Deploy code changes to the dev server via SSH: pull latest from GitHub,
  build API and frontend, restart services, and verify. Pattern also applies
  to production deployment (with the appropriate SSH key and server).
---

# Dev Server Deployment

## Quick Reference

**Dev server:** `root@2602:294:0:66d:3:fa3e:5395:3001`
**SSH key:** `/opt/baal-agent/workspace/.ssh/id_ed25519`
**Project path:** `/opt/baal-agent/workspace/pwsats-local`

## Steps

### 1. Push to GitHub (if not already done)

```bash
cd /opt/baal-agent/workspace/pwsats-local
git add -A && git commit -m "describe changes" && git push origin main
```

### 2. Pull + Build on Remote Server

```bash
# Clean working tree (no local changes):
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "cd /opt/baal-agent/workspace/pwsats-local && git pull origin main"

# Local changes on remote (use stash):
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "cd /opt/baal-agent/workspace/pwsats-local && git stash && git pull origin main && git stash pop"
```

### 3. Build Both Services

```bash
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "cd /opt/baal-agent/workspace/pwsats-local/artifacts/api-server && pnpm build && cd ../predictions-with-sats-web && pnpm build"
```

### 4. Restart API Service

```bash
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "systemctl restart pwsats-api && sleep 2 && systemctl is-active pwsats-api"
```

> **Note:** The frontend is served statically by Caddy — no restart needed. Caddy reads files from `dist/public/` directly.

### 5. Verify

```bash
# Check service is running
ssh ... "journalctl -u pwsats-api --no-pager --since '1 min ago' | grep -i 'WS scores\|error\|listening'"

# Check API responds with expected data
ssh ... "curl -s 'http://localhost:3001/api/sports-poly/markets' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f\"Markets: {len(d)}\")'"

# Test public URL (from localhost on the server, or from another machine)
curl -s "https://siege-letter-orphan-mandate.2n6.me/app/sports-poly" | head -5
```

## Common Issues

| Problem | Fix |
|---|---|
| `git pull` fails with "local changes would be overwritten" | `git stash && git pull && git stash pop` |
| `pnpm build` fails with missing module | The remote `.env` or `.gitignore`d files may differ — check what's committed vs local |
| Service restarts but not responding | `systemctl status pwsats-api` and `journalctl -u pwsats-api --no-pager -n 50` |
| Stuck process from previous restart | `pkill -9 -f 'node.*index.mjs'` then `systemctl restart pwsats-api` |
| Caddy not picking up new frontend | Caddy serves static files directly — just rebuild. No Caddy restart needed. |

## Production Deployment

Same steps but with:
- **Prod SSH key:** `/opt/baal-agent/workspace/.ssh/id_prod`
- **Prod domain:** `siege-letter-orphan-mandate.2n6.me` (resolves to `46.247.131.199`)
- **Prod NODE_ENV:** `production` in `.env`

> **Current blocker:** SSH access to prod server not configured. The `id_prod` key is rejected by the prod server's authorized_keys.
