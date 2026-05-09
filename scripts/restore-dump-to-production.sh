#!/usr/bin/env bash
# =============================================================================
# Restore a Database Dump to Production (MANUAL ONLY)
# =============================================================================
# WARNING: This OVERWRITES the entire production database. All existing
# production data (bets, markets, users) will be LOST.
#
# Use this ONLY when you need to restore a specific dump (e.g., migration
# with data, rollback, or disaster recovery).
#
# Usage:
#   ./scripts/restore-dump-to-production.sh          # Use latest dump from repo
#   ./scripts/restore-dump-to-production.sh /path/to/dump.sql  # Use specific dump
#
# Required env vars (same as deploy-to-production.sh):
#   PROD_HOST, PROD_PORT, PROD_SSH_KEY, DB_USER, DB_PASSWORD, DB_NAME
# =============================================================================

set -euo pipefail

PROD_HOST="${PROD_HOST:?Set PROD_HOST}"
PROD_PORT="${PROD_PORT:-22}"
PROD_SSH_KEY="${PROD_SSH_KEY:-}"
DB_USER="${DB_USER:-pwsats}"
DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"
DB_NAME="${DB_NAME:-pwsats_db}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP_FILE="${1:-${REPO_ROOT}/db/dump.sql}"

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

YELLOW='\033[1;33m'
RED='\033[1;31m'
GREEN='\033[1;32m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Safety confirmation
# ---------------------------------------------------------------------------
printf '\n${RED}================================================================${NC}\n'
printf '  ${RED}⚠️  WARNING: THIS WILL DESTROY ALL PRODUCTION DATA${NC}\n'
printf '  ${RED}================================================================${NC}\n'
printf '\n'
printf '  Target:    %s@%s:%s\n' "${DB_USER}" "${PROD_HOST}" "${DB_NAME}"
printf '  Dump file: %s\n' "${DUMP_FILE}"
printf '  Size:      %s\n' "$(du -h "${DUMP_FILE}" 2>/dev/null | cut -f1)"
printf '\n'

if [[ ! -f "${DUMP_FILE}" ]]; then
  printf '  ${RED}Dump file not found: %s${NC}\n' "${DUMP_FILE}" >&2
  exit 1
fi

read -r -p "  Type 'DESTROY' to confirm: " CONFIRM
if [[ "${CONFIRM}" != "DESTROY" ]]; then
  printf '  Aborted.\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Stop API to prevent writes during restore
# ---------------------------------------------------------------------------
printf '\n${YELLOW}[1/4] Stopping API service...${NC}\n'
$SSH "systemctl stop pwsats-api"

# ---------------------------------------------------------------------------
# Copy dump to production
# ---------------------------------------------------------------------------
printf '${YELLOW}[2/4] Copying dump to %s...${NC}\n' "${PROD_HOST}"
${SCP} "${DUMP_FILE}" "root@${PROD_HOST}:/tmp/dump.sql"

# ---------------------------------------------------------------------------
# Import dump (DROP existing data first)
# ---------------------------------------------------------------------------
printf '${YELLOW}[3/4] Importing dump into %s...${NC}\n' "${DB_NAME}"

$SSH "set -e

# Drop all data (preserve schema)
sudo -u postgres psql -d ${DB_NAME} <<EOSQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO ${DB_USER};
GRANT ALL ON SCHEMA public TO postgres;
EOSQL

# Import full dump
sudo -u postgres psql -d ${DB_NAME} -f /tmp/dump.sql

# Clean up
rm -f /tmp/dump.sql

# Re-grant permissions
sudo -u postgres psql -d ${DB_NAME} <<EOSQL
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${DB_USER};
EOSQL

echo 'Dump imported and grants applied'
"

# ---------------------------------------------------------------------------
# Restart API
# ---------------------------------------------------------------------------
printf '${YELLOW}[4/4] Restarting API...${NC}\n'
$SSH "systemctl start pwsats-api"
sleep 2

$SSH "systemctl is-active pwsats-api" >/dev/null 2>&1 && \
  printf '\n  ${GREEN}Database restored and API restarted successfully.${NC}\n' || \
  printf '\n  ${RED}API failed to start! Check logs:${NC}\n'
  printf '    %s "journalctl -u pwsats-api -n 30 --no-pager"\n' "$SSH"
