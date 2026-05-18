---
name: dev-prod-sync
description: Sync dev server, git remote, and production servers. Verify all environments are on the same commit, clean up artifacts, and update MEMORY.md with verified server details. Use after deploys, reverts, or when checking environment consistency.
---

# Dev-Prod Sync Check

## Purpose
Verify that dev server, GitHub (origin/main), and production are all on the same commit. Clean up temporary files and update memory with verified server details.

## Server Access Chain
```
Agent VM → Dev (IPv6: 2602:294:0:66d:3:fa3e:5395:3001, key: id_ed25519) → Prod (37.114.37.140:24003, key: ~/.ssh/prd_key on dev)
```

## Steps

### 1. Check dev state
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 -o ConnectTimeout=10 -o BatchMode=yes root@2602:294:0:66d:3:fa3e:5395:3001 '
  cd /opt/baal-agent/workspace/pwsats-local &&
  echo "=== Git status ===" && git status &&
  echo "=== HEAD ===" && git rev-parse HEAD &&
  echo "=== Origin ===" && git rev-parse origin/main &&
  echo "=== Services ===" && systemctl is-active pwsats-api
'
```

### 2. Check prod state (via dev jump)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    cd /opt/Predictions-With-Sats &&
    echo HEAD=\$(git rev-parse HEAD) &&
    systemctl is-active pwsats-api &&
    systemctl is-active pwsats-web &&
    systemctl is-active caddy
  "
'
```

### 3. Clean up artifacts
```bash
# On dev:
find /opt/baal-agent/workspace/pwsats-local/artifacts/predictions-with-sats-web/src/pages/ -name "*.bak*" -delete 2>/dev/null

# On prod (via dev):
ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 '
  find /opt/Predictions-With-Sats/artifacts/predictions-with-sats-web/src/pages/ -name "*.bak*" -delete 2>/dev/null
'
```

### 4. Gather server metadata
```bash
# Dev:
hostname -f
cat /etc/caddy/Caddyfile
cat /etc/caddy/conf.d/pwsats.caddy

# Prod:
hostname -f
cat /etc/caddy/Caddyfile
```

### 5. Update MEMORY.md
Update `/opt/baal-agent/workspace/memory/MEMORY.md` with verified:
- Dev hostname and Caddy domain
- Prod hostname, domain, and Caddy config
- Current HEAD commit across all environments
- Any known issues discovered during sync

## Key Facts (verify each time)
| Item | Dev | Prod |
|------|-----|------|
| Host | `root@2602:294:0:66d:3:fa3e:5395:3001` | `root@37.114.37.140:24003` |
| SSH Key | `/opt/baal-agent/workspace/.ssh/id_ed25519` | `~/.ssh/prd_key` (on dev) |
| Project Path | `/opt/baal-agent/workspace/pwsats-local` | `/opt/Predictions-With-Sats` |
| DB | `postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev` | `postgresql://pwsats:p4borge55@localhost:5432/pwsats_db` |
| Domain | `when-verb-torch-gas.2n6.me` | `pwsats.com` |
| Web Service | Caddy (static files) | `pwsats-web` + Caddy |
