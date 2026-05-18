---
name: prod-deploy
description: Deploy to the production server (37.114.37.140:24003) by jumping SSH through the dev server. Includes git pull, dependency install, build, DB migrations, service restart, and verification.
---

# Production Deploy (via SSH Jump)

## Prerequisites

- **Dev server**: `root@2602:294:0:66d:3:fa3e:5395:3001` (your Aleph Cloud VM)
- **Prod server**: `root@37.114.37.140` on port **24003** (OVH)
- **SSH key chain**: `id_ed25519` on local → dev, then `~/.ssh/prd_key` on dev → prod
- **No direct SSH** from local to prod — must jump through dev

## SSH Config on Dev Server

The dev server has a ready-made SSH config:

```
Host prd
    HostName 37.114.37.140
    Port 24003
    User root
    IdentityFile ~/.ssh/prd_key
    StrictHostKeyChecking no
```

So from dev you can just `ssh prd`.

## One-Liner Pattern (local → dev → prod)

```bash
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=10 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 'COMMAND_ON_PROD' 2>&1"
```

## Deploy Steps

### 1. Pull latest code

```bash
# Via jump:
ssh -i ~/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 \
  'cd /opt/Predictions-With-Sats && git pull origin main'"
```

### 2. Install dependencies

```bash
# Via jump — only needed if new deps were added:
ssh ... "ssh ... 'cd /opt/Predictions-With-Sats && pnpm install'"
```

If a new dependency is imported but not in `package.json`, install it explicitly:
```bash
ssh ... "ssh ... 'cd /opt/Predictions-With-Sats/artifacts/api-server && pnpm add <pkg>'"
```

### 3. Build

```bash
# API server:
ssh ... "ssh ... 'cd /opt/Predictions-With-Sats/artifacts/api-server && pnpm build'"

# Frontend:
ssh ... "ssh ... 'cd /opt/Predictions-With-Sats/artifacts/predictions-with-sats-web && pnpm build'"
```

### 4. DB migrations (manual SQL)

Prod uses PostgreSQL: `postgresql://pwsats:p4borge55@localhost:5432/pwsats_db`

Write a SQL file on prod, then run it:

```bash
ssh ... "ssh ... 'cat > /tmp/migrate.sql << '\''EOF'\''
ALTER TABLE sport_poly_markets ADD COLUMN IF NOT EXISTS new_col TEXT;
EOF
psql postgresql://pwsats:p4borge55@localhost:5432/pwsats_db -f /tmp/migrate.sql'"
```

### 5. Restart services

```bash
ssh ... "ssh ... 'systemctl restart pwsats-api && systemctl restart pwsats-web'"
```

### 6. Verify

```bash
# Check services are active:
ssh ... "ssh ... 'systemctl is-active pwsats-api && systemctl is-active pwsats-web'"

# Check recent logs:
ssh ... "ssh ... 'journalctl -u pwsats-api --no-pager --since \"2 min ago\" | grep -i \"error\|starting\|connected\"'"

# Check public endpoint:
curl -s -o /dev/null -w "%{http_code}\n" "https://siege-letter-orphan-mandate.2n6.me/"
```

## Pitfalls

- **`ws` package**: Must be explicitly in `api-server/package.json` dependencies. It's a transitive dep that doesn't always hoist correctly on prod.
- **Escaping**: Nested SSH with quotes is error-prone. Use single-quoted heredocs (`<< 'EOF'`) for multi-line content, or write to a temp file first.
- **Prod IP**: The prod server is at `37.114.37.140:24003`, NOT `46.247.131.199:22` (which is where the `.2n6.me` domain resolves). They're different machines.
- **Node env**: Prod runs with `NODE_ENV=development` (set in `.env`).
