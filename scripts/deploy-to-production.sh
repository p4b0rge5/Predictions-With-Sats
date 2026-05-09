#!/usr/bin/env bash
# =============================================================================
# Deploy Predictions-With-Sats to a fresh Aleph Cloud VM (production)
# =============================================================================
# This script is run on the DEV machine and deploys remotely via SSH to the
# production server.
#
# Usage:
#   ./scripts/deploy-to-production.sh
#
# Required environment variables (or set in .env.deploy):
#   PROD_HOST          Production IP       (e.g. 37.114.37.140)
#   PROD_PORT          SSH port            (e.g. 24003)
#   PROD_SSH_KEY       Path to SSH private key
#   DOMAIN             Production domain   (e.g. pwsats.com)
#   DB_USER            PostgreSQL username  (e.g. pwsats)
#   DB_PASSWORD        PostgreSQL password
#   DB_NAME            PostgreSQL database  (e.g. pwsats_db)
#   GITHUB_CLONE_URL   Full git clone URL with PAT
#
# Alternatively, source .env.deploy before running:
#   source .env.deploy && ./scripts/deploy-to-production.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override with env vars)
# ---------------------------------------------------------------------------
PROD_HOST="${PROD_HOST:?Set PROD_HOST}"
PROD_PORT="${PROD_PORT:-22}"
PROD_SSH_KEY="${PROD_SSH_KEY:-}"
DOMAIN="${DOMAIN:?Set DOMAIN}"
DB_USER="${DB_USER:-pwsats}"
DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"
DB_NAME="${DB_NAME:-pwsats_db}"
GITHUB_CLONE_URL="${GITHUB_CLONE_URL:?Set GITHUB_CLONE_URL}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="Predictions-With-Sats"
REMOTE_PATH="/opt/${REPO_NAME}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
if [[ -n "${PROD_SSH_KEY}" ]]; then
  SSH="ssh -i ${PROD_SSH_KEY} ${SSH_OPTS} -p ${PROD_PORT} root@${PROD_HOST}"
  SCP="scp -i ${PROD_SSH_KEY} ${SSH_OPTS} -P ${PROD_PORT}"
else
  SSH="ssh ${SSH_OPTS} -p ${PROD_PORT} root@${PROD_HOST}"
  SCP="scp ${SSH_OPTS} -P ${PROD_PORT}"
fi

GREEN='\033[1;32m'
BLUE='\033[1;34m'
RED='\033[1;31m'
NC='\033[0m'

log()  { printf '\n${BLUE}==>${NC} %s\n' "$*"; }
ok()   { printf '  ${GREEN}[ok]${NC} %s\n' "$*"; }
err()  { printf '  ${RED}[erro]${NC} %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "Pre-flight checks"

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  err ".env not found in ${REPO_ROOT}. Set up the dev environment first."
fi

if [[ ! -f "${REPO_ROOT}/db/dump.sql" ]]; then
  err "db/dump.sql not found. Run a DB dump first."
fi

# Test SSH connectivity
$SSH echo "SSH connection OK" >/dev/null 2>&1 || err "Cannot SSH to ${PROD_HOST}:${PROD_PORT}"
ok "SSH connection to ${PROD_HOST} OK"

# ---------------------------------------------------------------------------
# Step 1: Install system dependencies
# ---------------------------------------------------------------------------
log "Step 1/8: Installing system dependencies on ${PROD_HOST}"

# Detect OS to pick correct PostgreSQL version
OS_TYPE=$($SSH 'cat /etc/os-release 2>/dev/null | grep "^ID=" | cut -d= -f2' 2>/dev/null || echo "debian")

if [[ "${OS_TYPE}" == "debian" ]]; then
  PG_VERSION="15"
else
  PG_VERSION="16"
fi

$SSH "set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git wget gnupg2 lsb-release ca-certificates

# Node.js 20
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

# pnpm
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi

# PostgreSQL
if ! command -v psql &>/dev/null; then
  apt-get install -y -qq postgresql postgresql-contrib
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  apt-get install -y -qq caddy
fi

echo '---versions---'
node --version
pnpm --version
pg_config --version
caddy version
"

ok "Dependencies installed (Node, pnpm, PostgreSQL ${PG_VERSION}, Caddy)"

# ---------------------------------------------------------------------------
# Step 2: PostgreSQL setup
# ---------------------------------------------------------------------------
log "Step 2/8: Setting up PostgreSQL"

$SSH "set -e
# Ensure PostgreSQL is running
pg_ctlcluster ${PG_VERSION} main start 2>/dev/null || systemctl start postgresql
systemctl enable postgresql 2>/dev/null || true

# Create user and database (idempotent)
sudo -u postgres psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}' CREATEDB;\"

sudo -u postgres psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"

echo 'PostgreSQL ready'
sudo -u postgres psql -l | grep ${DB_NAME}
"

ok "PostgreSQL configured (${DB_USER}@${DB_NAME})"

# ---------------------------------------------------------------------------
# Step 3: Clone repo
# ---------------------------------------------------------------------------
log "Step 3/8: Cloning repository"

$SSH "set -e
cd /opt
if [[ -d '${REPO_NAME}' ]]; then
  cd ${REPO_NAME}
  git pull
else
  git clone ${GITHUB_CLONE_URL}
  cd ${REPO_NAME}
fi
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo 'Clone + install done'
"

ok "Repository cloned and dependencies installed"

# ---------------------------------------------------------------------------
# Step 4: Copy .env and dump
# ---------------------------------------------------------------------------
log "Step 4/8: Copying .env and database dump"

${SCP} "${REPO_ROOT}/.env" "root@${PROD_HOST}:${REMOTE_PATH}/.env" 2>/dev/null
${SCP} "${REPO_ROOT}/db/dump.sql" "root@${PROD_HOST}:/tmp/dump.sql"

$SSH "set -e
chmod 600 ${REMOTE_PATH}/.env

# Import dump
sudo -u postgres psql -d ${DB_NAME} -f /tmp/dump.sql
rm -f /tmp/dump.sql

# Grant all privileges to DB user
sudo -u postgres psql -d ${DB_NAME} <<EOSQL
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo 'Database dump imported and permissions granted'
"

ok "Database dump imported"

# ---------------------------------------------------------------------------
# Step 5: Build
# ---------------------------------------------------------------------------
log "Step 5/8: Building API and web frontend"

$SSH "set -e
cd ${REMOTE_PATH}
pnpm --filter @workspace/api-server run build

# BASE_PATH=/ for production root (no sub-path prefix)
BASE_PATH=/ pnpm --filter @workspace/predictions-with-sats-web run build

echo '---'
ls artifacts/predictions-with-sats-web/dist/public/
echo 'Build complete'
"

ok "Build complete (BASE_PATH=/)"

# ---------------------------------------------------------------------------
# Step 6: Create systemd services
# ---------------------------------------------------------------------------
log "Step 6/8: Creating systemd services"

$SSH "cat > /etc/systemd/system/pwsats-api.service << 'SVCEOF'
[Unit]
Description=Predictions With Sats API Server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${REMOTE_PATH}/artifacts/api-server
EnvironmentFile=${REMOTE_PATH}/.env
ExecStart=/usr/bin/node ${REMOTE_PATH}/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

cat > /etc/systemd/system/pwsats-web.service << 'SVCEOF'
[Unit]
Description=Predictions With Sats Web Frontend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${REMOTE_PATH}/artifacts/predictions-with-sats-web
ExecStart=${REMOTE_PATH}/artifacts/predictions-with-sats-web/node_modules/.bin/vite preview --port 3002
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable --now pwsats-api pwsats-web

# Wait and verify
sleep 3
systemctl is-active pwsats-api
systemctl is-active pwsats-web
ss -tlnp | grep -E ':300[12]'
"

ok "systemd services created and started (pwsats-api:3001, pwsats-web:3002)"

# ---------------------------------------------------------------------------
# Step 7: Configure Caddy
# ---------------------------------------------------------------------------
log "Step 7/8: Configuring Caddy with HTTPS"

$SSH "cat > /etc/caddy/Caddyfile << CADDYEOF
{
	email admin@${DOMAIN}
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

${DOMAIN} {
	encode gzip

	# API routes → backend
	handle /api* {
		reverse_proxy localhost:3001
	}

	# Everything else → SPA (static files with fallback)
	handle {
		root * ${REMOTE_PATH}/artifacts/predictions-with-sats-web/dist/public
		try_files {path} /index.html
		file_server
	}
}
CADDYEOF

# Stop any running Caddy (might have leftover cert issues)
caddy stop 2>/dev/null || true
sleep 1

# Clear any stale cert data that might cause issues
rm -rf /var/lib/caddy/.local/share/caddy/certificates/ 2>/dev/null || true
rm -rf /root/.local/share/caddy/ 2>/dev/null || true

# Start Caddy fresh — it will obtain cert via HTTP-01 challenge
caddy start

echo 'Caddy started — waiting for Let\\'s Encrypt cert...'
"

ok "Caddy configured. Waiting 25s for Let's Encrypt certificate..."
sleep 25

# ---------------------------------------------------------------------------
# Step 8: Verify
# ---------------------------------------------------------------------------
log "Step 8/8: Verification"

CADDY_ACTIVE=$($SSH "systemctl is-active caddy" 2>/dev/null || echo "inactive")
API_ACTIVE=$($SSH "systemctl is-active pwsats-api" 2>/dev/null || echo "inactive")
WEB_ACTIVE=$($SSH "systemctl is-active pwsats-web" 2>/dev/null || echo "inactive")

echo ""
printf '  ${BLUE}=== Final Status ===${NC}\n'
printf '  Caddy:     %s\n' "$CADDY_ACTIVE"
printf '  pwsats-api: %s\n' "$API_ACTIVE"
printf '  pwsats-web: %s\n' "$WEB_ACTIVE"
echo ""

# Try HTTPS
HTTPS_STATUS=$($SSH "curl -sk -o /dev/null -w '%%{http_code}' https://${DOMAIN}/" 2>/dev/null || echo "000")
API_STATUS=$($SSH "curl -sk -o /dev/null -w '%%{http_code}' https://${DOMAIN}/api/healthz" 2>/dev/null || echo "000")

printf '  Frontend (GET /): %s\n' "$HTTPS_STATUS"
printf '  API health:       %s\n' "$API_STATUS"

if [[ "${CADDY_ACTIVE}" == "active" && "${API_ACTIVE}" == "active" && "$HTTPS_STATUS" == "200" ]]; then
  printf '\n  ${GREEN}🎉 Deploy successful! Open https://%s${NC}\n' "${DOMAIN}"
else
  printf '\n  ${RED}⚠️ Some services may need attention. Check logs:${NC}\n'
  printf '    $ %s "journalctl -u caddy -n 20 --no-pager"\n' "$SSH"
  printf '    $ %s "journalctl -u pwsats-api -n 20 --no-pager"\n' "$SSH"
fi
