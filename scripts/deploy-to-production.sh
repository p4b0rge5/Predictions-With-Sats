#!/usr/bin/env bash
# =============================================================================
# Deploy Predictions-With-Sats to Production (remote via SSH)
# =============================================================================
# This script is run on the DEV machine and deploys remotely via SSH to the
# production server.
#
# IMPORTANT: This script does NOT import database dumps. Production data is
# never overwritten by dev test data. Schema migrations are applied via
# Drizzle push. Use scripts/restore-dump-to-production.sh for manual restores.
#
# Usage:
#   ./scripts/deploy-to-production.sh            # Full deploy (fresh or update)
#   ./scripts/deploy-to-production.sh quick      # Quick deploy (skip deps install)
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

QUICK_MODE="${1:-full}"
if [[ "${QUICK_MODE}" == "quick" ]]; then
  SKIP_DEPS=true
else
  SKIP_DEPS=false
fi

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
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf '\n${BLUE}==>${NC} %s\n' "$*"; }
ok()   { printf '  ${GREEN}[ok]${NC} %s\n' "$*"; }
warn() { printf '  ${YELLOW}[warn]${NC} %s\n' "$*"; }
err()  { printf '  ${RED}[erro]${NC} %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "Pre-flight checks"

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  err ".env not found in ${REPO_ROOT}. Set up the dev environment first."
fi

# Test SSH connectivity
$SSH echo "SSH connection OK" >/dev/null 2>&1 || err "Cannot SSH to ${PROD_HOST}:${PROD_PORT}"
ok "SSH connection to ${PROD_HOST} OK"

if [[ "${SKIP_DEPS}" == "true" ]]; then
  warn "Quick mode — skipping dependency installation"
fi

# ---------------------------------------------------------------------------
# Step 1: Install system dependencies (skip in quick mode)
# ---------------------------------------------------------------------------
if [[ "${SKIP_DEPS}" == "false" ]]; then
  log "Step 1: Installing system dependencies on ${PROD_HOST}"

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

  ok "Dependencies installed"
else
  PG_VERSION=$($SSH 'ls /etc/postgresql/ 2>/dev/null | head -1' 2>/dev/null || echo "15")
fi

# ---------------------------------------------------------------------------
# Step 2: PostgreSQL setup
# ---------------------------------------------------------------------------
log "Step 2: Ensuring PostgreSQL is ready"

$SSH "set -e
# Ensure PostgreSQL is running
pg_ctlcluster ${PG_VERSION} main start 2>/dev/null || systemctl start postgresql
systemctl enable postgresql 2>/dev/null || true

# Create user and database (idempotent - no-op if exists)
sudo -u postgres psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}' CREATEDB;\"

sudo -u postgres psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1 || \\
  sudo -u postgres psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"

echo 'PostgreSQL ready'
"

ok "PostgreSQL configured (${DB_USER}@${DB_NAME})"

# ---------------------------------------------------------------------------
# Step 3: Clone/pull repo + install dependencies
# ---------------------------------------------------------------------------
log "Step 3: Updating repository on ${PROD_HOST}"

$SSH "set -e
cd /opt
if [[ -d '${REPO_NAME}/.git' ]]; then
  cd ${REPO_NAME}
  git fetch origin
  git reset --hard origin/main
else
  git clone ${GITHUB_CLONE_URL}
  cd ${REPO_NAME}
fi

pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo 'Repo updated and dependencies installed'
"

ok "Repository updated"

# ---------------------------------------------------------------------------
# Step 4: Copy .env (runtime config only, NO database dump)
# ---------------------------------------------------------------------------
log "Step 4: Copying .env to ${PROD_HOST}"
warn "  Database dump is NOT imported. Production data is preserved."
warn "  For manual dump restore: ./scripts/restore-dump-to-production.sh"

${SCP} "${REPO_ROOT}/.env" "root@${PROD_HOST}:${REMOTE_PATH}/.env"

$SSH "chmod 600 ${REMOTE_PATH}/.env"

ok ".env copied (no dump imported)"

# ---------------------------------------------------------------------------
# Step 5: Apply database schema migrations (Drizzle push)
# ---------------------------------------------------------------------------
log "Step 5: Applying Drizzle schema migrations"

$SSH "set -e
cd ${REMOTE_PATH}

# Load DATABASE_URL from .env so drizzle-kit can connect
export DATABASE_URL='postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}'

# Run Drizzle push to sync schema with production DB
# This adds/alters columns and tables WITHOUT dropping data
pnpm --filter @workspace/database exec npx drizzle-kit push

# Ensure grants are up to date
sudo -u postgres psql -d ${DB_NAME} <<EOSQL
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo 'Schema migrations applied and grants refreshed'
"

ok "Schema migrations applied (production data preserved)"

# ---------------------------------------------------------------------------
# Step 6: Build
# ---------------------------------------------------------------------------
log "Step 6: Building API and web frontend"

$SSH "set -e
cd ${REMOTE_PATH}

# Build API
pnpm --filter @workspace/api-server run build

# Build web with BASE_PATH=/ for production root
BASE_PATH=/ pnpm --filter @workspace/predictions-with-sats-web run build

echo '---'
ls artifacts/predictions-with-sats-web/dist/public/
echo 'Build complete'
"

ok "Build complete (BASE_PATH=/)"

# ---------------------------------------------------------------------------
# Step 7: Restart services
# ---------------------------------------------------------------------------
log "Step 7: Restarting services"

$SSH "set -e
systemctl restart pwsats-api
systemctl restart pwsats-web
sleep 2
systemctl is-active pwsats-api
systemctl is-active pwsats-web
ss -tlnp | grep -E ':300[12]'
"

ok "Services restarted (pwsats-api:3001, pwsats-web:3002)"

# ---------------------------------------------------------------------------
# Step 8: Verify Caddy + HTTPS
# ---------------------------------------------------------------------------
log "Step 8: Verifying Caddy and HTTPS"

# Ensure Caddy config is correct (idempotent)
$SSH "cat > /etc/caddy/Caddyfile << CADDYEOF
{
	email admin@${DOMAIN}
	acme_ca https://acme-v02.api.letsencrypt.org/directory
}

${DOMAIN} {
	encode gzip

	# API routes to backend
	handle /api* {
		reverse_proxy localhost:3001
	}

	# Everything else to SPA (static files with fallback)
	handle {
		root * ${REMOTE_PATH}/artifacts/predictions-with-sats-web/dist/public
		try_files {path} /index.html
		file_server
	}
}
CADDYEOF

# Reload Caddy (preserves existing cert)
caddy reload 2>/dev/null || caddy start
sleep 2
"

ok "Caddy reloaded"

# ---------------------------------------------------------------------------
# Step 9: Final verification
# ---------------------------------------------------------------------------
log "Step 9: Final verification"

CADDY_ACTIVE=$($SSH "systemctl is-active caddy" 2>/dev/null || echo "inactive")
API_ACTIVE=$($SSH "systemctl is-active pwsats-api" 2>/dev/null || echo "inactive")

HTTPS_STATUS=$($SSH "curl -sk -o /dev/null -w '%%{http_code}' https://${DOMAIN}/" 2>/dev/null || echo "000")
API_STATUS=$($SSH "curl -sk -o /dev/null -w '%%{http_code}' https://${DOMAIN}/api/healthz" 2>/dev/null || echo "000")
CERT_INFO=$($SSH "echo | openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null" || echo "unknown")

echo ""
printf '  ${BLUE}================================================${NC}\n'
printf '  ${BLUE}  Deploy Result${NC}\n'
printf '  ${BLUE}================================================${NC}\n'
printf '  Caddy:       %s\n' "$CADDY_ACTIVE"
printf '  pwsats-api:  %s\n' "$API_ACTIVE"
printf '  Frontend:    %s (https://%s)\n' "$HTTPS_STATUS" "${DOMAIN}"
printf '  API health:  %s (/api/healthz)\n' "$API_STATUS"
printf '  Cert:        %s\n' "$CERT_INFO"
printf '  ${BLUE}================================================${NC}\n'

if [[ "${CADDY_ACTIVE}" == "active" && "${API_ACTIVE}" == "active" && "$HTTPS_STATUS" == "200" ]]; then
  printf '\n  ${GREEN}Deploy successful! Open https://%s${NC}\n' "${DOMAIN}"
else
  printf '\n  ${RED}Some services need attention:${NC}\n'
  printf '    %s "journalctl -u caddy -n 20 --no-pager"\n' "$SSH"
  printf '    %s "journalctl -u pwsats-api -n 20 --no-pager"\n' "$SSH"
fi
