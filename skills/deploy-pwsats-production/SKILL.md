---
name: deploy-pwsats-production
description: >-
  Deploy the Predictions-With-Sats fullstack application to a fresh Aleph Cloud VM
  as the primary site (BASE_PATH=/) with PostgreSQL, Node.js, systemd services,
  and Caddy reverse proxy with automatic HTTPS via Let's Encrypt.
  Includes automated remote deployment script.
---

# Deploy PWSats to Production on Aleph Cloud

## Quick Start — Automated Script

The repo includes a fully automated deployment script:

```bash
# From the dev machine, in the repo root:
cd /opt/baal-agent/workspace/Predictions-With-Sats

# Set required env vars or create .env.deploy:
export PROD_HOST=37.114.37.140
export PROD_PORT=24003
export PROD_SSH_KEY=/root/.ssh/id_ed25519_deployment
export DOMAIN=pwsats.com
export DB_USER=pwsats
export DB_PASSWORD=p4borge55
export DB_NAME=pwsats_db
export GITHUB_CLONE_URL="https://p4b0rge5:YOUR_TOKEN@github.com/p4b0rge5/Predictions-With-Sats.git"

./scripts/deploy-to-production.sh
```

This script handles all 8 steps below automatically: pre-flight, dependencies, PostgreSQL, clone, dump import, build, systemd, Caddy + HTTPS.

---

## Manual Step-by-Step Reference

### Prerequisites
- Fresh Debian 12 or Ubuntu 24.04 VM on Aleph Cloud
- SSH access as root (Aleph Cloud uses custom ports, e.g., `-p 24003`)
- Domain DNS (**both A + AAAA records**) pointing to the new VM — **no stale records**
- GitHub PAT embedded in clone URL
- Deployment SSH key (ed25519)
- `.env` file and `db/dump.sql` from the dev machine

### Step 1: Install Dependencies

```bash
SSH='ssh -i KEY -p PORT root@IP'

$SSH "set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl git wget gnupg2 lsb-release ca-certificates

# Node.js 20 (use existing if already installed)
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi

# PostgreSQL
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql postgresql-contrib
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  apt-get install -y caddy
fi
"
```

**Versions on Debian 12:** Node v20.20.2, pnpm 10.33.4, PostgreSQL 15.16, Caddy 2.6.2
**Versions on Ubuntu 24.04:** Node v20.20.2, pnpm 10.33.x, PostgreSQL 16.13, Caddy 2.8.x

### Step 2: Set Up PostgreSQL

```bash
# Detect PG version (15 on Debian, 16 on Ubuntu)
PG_VERSION=$($SSH "ls /etc/postgresql/ | head -1")

$SSH "set -e
pg_ctlcluster ${PG_VERSION} main start
systemctl enable postgresql

sudo -u postgres psql -c \"SELECT 1 FROM pg_roles WHERE rolname='p4borge55'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE USER p4borge55 WITH PASSWORD 'p4borge55' CREATEDB;\"

sudo -u postgres psql -c \"SELECT 1 FROM pg_roles WHERE rolname='pwsats'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE USER pwsats WITH PASSWORD 'p4borge55' CREATEDB;\"

sudo -u postgres psql -tc \"SELECT 1 FROM pg_database WHERE datname='pwsats_db'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE DATABASE pwsats_db OWNER p4borge55;\"
"
```

**CRITICAL:** Create **both** `p4borge55` (owner, for dumps/GRANTs) and `pwsats` (app user, used by `.env`'s `DATABASE_URL`).

### Step 3: Clone Repo & Install

```bash
$SSH "set -e
cd /opt
git clone ${GITHUB_CLONE_URL}
cd Predictions-With-Sats
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
"
```

### Step 4: Copy .env and Import Database Dump

```bash
# From dev machine
SCP='scp -i KEY -P PORT'
${SCP} /path/to/.env root@PROD_IP:/opt/Predictions-With-Sats/.env
${SCP} /path/to/db/dump.sql root@PROD_IP:/tmp/dump.sql

$SSH "set -e
chmod 600 /opt/Predictions-With-Sats/.env

# Import dump
sudo -u postgres psql -d pwsats_db -f /tmp/dump.sql
rm -f /tmp/dump.sql

# CRITICAL: Grant ALL permissions to app user (pwsats)
# The dump creates tables owned by postgres, so pwsats can't read them!
sudo -u postgres psql -d pwsats_db <<EOSQL
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pwsats;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pwsats;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pwsats;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pwsats;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO pwsats;
EOSQL
"
```

### Step 5: Build

```bash
$SSH "set -e
cd /opt/Predictions-With-Sats
pnpm --filter @workspace/api-server run build
BASE_PATH=/ pnpm --filter @workspace/predictions-with-sats-web run build

# Verify no sub-path prefix in assets
grep -oP 'src=\"[^\"]+\"' artifacts/predictions-with-sats-web/dist/public/index.html
"
```

**CRITICAL:** Use `BASE_PATH=/` for production root deployment. This means assets reference `/assets/...` not `/app/assets/...`.

### Step 6: Create systemd Services

**pwsats-api.service:**
```ini
[Unit]
Description=Predictions With Sats API Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/Predictions-With-Sats/artifacts/api-server
EnvironmentFile=/opt/Predictions-With-Sats/.env
ExecStart=/usr/bin/node /opt/Predictions-With-Sats/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**pwsats-web.service:**
```ini
[Unit]
Description=Predictions With Sats Web Frontend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/Predictions-With-Sats/artifacts/predictions-with-sats-web
ExecStart=/opt/Predictions-With-Sats/artifacts/predictions-with-sats-web/node_modules/.bin/vite preview --port 3002
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
$SSH "systemctl daemon-reload
systemctl enable --now pwsats-api pwsats-web
sleep 3
ss -tlnp | grep -E ':300[12]'
"
```

### Step 7: Configure Caddy

```caddyfile
{
	email admin@pwsats.com
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

pwsats.com {
	encode gzip

	# API routes → backend
	handle /api* {
		reverse_proxy localhost:3001
	}

	# Everything else → SPA (static files with fallback)
	handle {
		root * /opt/Predictions-With-Sats/artifacts/predictions-with-sats-web/dist/public
		try_files {path} /index.html
		file_server
	}
}
```

```bash
$SSH "caddy start"
```

Caddy obtains the Let's Encrypt cert **automatically** via HTTP-01 challenge on ports 80/443.

### Step 8: Verify

```bash
# Services
$SSH "systemctl is-active caddy && systemctl is-active pwsats-api && systemctl is-active pwsats-web"

# HTTPS
curl -sk https://pwsats.com/ | head -5
curl -sk https://pwsats.com/api/healthz

# Certificate
echo | openssl s_client -connect pwsats.com:443 -servername pwsats.com 2>/dev/null | openssl x509 -noout -dates -subject
```

---

## Architecture Notes

### Why Caddy handles SPA directly (not Vite preview)
The Caddy config uses `file_server` + `try_files {path} /index.html` to serve static files. The `pwsats-web` systemd service (vite preview) is a fallback — in production, Caddy serves all static assets directly from the build output. This is more efficient and matches the production architecture.

### Why handle blocks (not mix of reverse_proxy + file_server)
In Caddy, mixing `reverse_proxy` directive with `try_files` + `file_server` in the same block causes `file_server` to intercept `/api/*` routes and serve `index.html` instead. The `handle /api* { reverse_proxy ... }` block ensures API routes are handled independently before the SPA handler.

### BASE_PATH=/ for production
The frontend Vite build must use `BASE_PATH=/` so that asset paths are absolute (`/assets/...`). With a sub-path like `/app`, the assets would 404 because Caddy serves from `/`.

---

## Common Pitfalls (Learned from 2026-05-09 Deploy)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Let's Encrypt `connection refused` on wrong IP | DNS AAAA still pointing to old server | Update **both** A and AAAA records; verify with `dig +short pwsats.com AAAA @2001:4860:4860::8888` |
| Let's Encrypt `no IPv4 addresses to try as fallback` | Only had AAAA, no A record | Add A record for IPv4 (`37.114.37.140`) as fallback |
| Caddy fails to start — `address already in use` (port 2019) | Stale Caddy process from manual `caddy run` | `pkill -9 caddy` before `systemctl start caddy` |
| Caddy systemd fails — cert files owned by root, not caddy user | Manual `caddy run` as root saved certs to `/root/.local/share/caddy/` | `rm -rf /root/.local/share/caddy/` and `/var/lib/caddy/.local/share/caddy/certificates/`, then restart |
| API returns `permission denied for table` | Dump creates tables as `postgres`, app user `pwsats` has no grants | Run `GRANT ALL ON ALL TABLES/SEQUENCES TO pwsats` after import |
| API returns `password authentication failed for user "pwsats"` | Only `p4borge55` user created, but `.env` uses `pwsats` | Create both users: `p4borge55` (owner) and `pwsats` (app user, same password) |
| `/api/*` returns HTML instead of JSON | Caddy `try_files` + `file_server` intercepts all routes | Use `handle /api* { reverse_proxy ... }` as separate block |
| White page on SPA after `BASE_PATH=/` | Build used old `BASE_PATH=/app` | Rebuild with `BASE_PATH=/ pnpm --filter @workspace/predictions-with-sats-web run build` |
| `Could not read certificate from <stdin>` | Caddy user can't read cert files from `/root/.local/share/caddy/` | Clear stale cert data before restart |

### DNS-01 vs HTTP-01 vs TLS-ALPN-01

For IPv6-only servers, Let's Encrypt prefers `tls-alpn-01`. If DNS AAAA still points elsewhere, both `http-01` and `tls-alpn-01` fail. The fix is ensuring **both** A and AAAA records point to the new server before restarting Caddy.

If you have an **A record** (IPv4) pointing correctly, `http-01` will succeed even if AAAA is stale. But ideally both should be correct.

### PostgreSQL Version Differences

- **Debian 12** → PostgreSQL **15** (package `postgresql-15`)
- **Ubuntu 24.04** → PostgreSQL **16** (package `postgresql-16`)
- Always detect: `pg_version=$(ls /etc/postgresql/ | head -1)` and use `pg_ctlcluster ${pg_version} main start`

### Aleph Cloud Specifics

- SSH on custom ports (not 22)
- Debian 12 by default
- VM hostname is a long hash (e.g., `bvxfyf7fuoufzgtih7zpxgowawty7oi5i5amg6hdrj4hilk3y7gq`)
- No firewall by default — ports 80, 443, custom SSH are all open
- Caddy systemd user is `caddy` (group `caddy`), data dir: `/var/lib/caddy/.local/share/caddy`
