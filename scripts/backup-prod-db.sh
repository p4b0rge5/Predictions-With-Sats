#!/usr/bin/env bash
# =============================================================================
# Backup Production Database → Dev Machine
# =============================================================================
# Runs on the DEV machine. SSH connects to production, runs pg_dump, and
# stores the compressed dump locally with date-based retention.
#
# Usage:
#   ./scripts/backup-prod-db.sh                    # Use .env.deploy defaults
#   source .env.deploy && ./scripts/backup-prod-db.sh
#
# Required env vars (same as deploy-to-production.sh):
#   PROD_HOST      Production IP       (e.g. 37.114.37.140)
#   PROD_PORT      SSH port            (e.g. 24003)
#   PROD_SSH_KEY   Path to SSH private key
#   DB_USER        PostgreSQL username  (default: p4borge55 — owner for pg_dump)
#   DB_PASSWORD    PostgreSQL password
#   DB_NAME        PostgreSQL database  (default: pwsats_db)
#
# Retention: Keeps last $RETENTION_DAYS days of backups (default: 30)
# Dumps stored in: backups/ (relative to repo root)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override with env vars)
# ---------------------------------------------------------------------------
PROD_HOST="${PROD_HOST:?Set PROD_HOST}"
PROD_PORT="${PROD_PORT:-22}"
PROD_SSH_KEY="${PROD_SSH_KEY:-}"
DB_USER="${DB_USER:-p4borge55}"
DB_PASSWORD="${DB_PASSWORD:?Set DB_PASSWORD}"
DB_NAME="${DB_NAME:-pwsats_db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DATE_ONLY="$(date +%Y-%m-%d)"

# SSH/SCP helpers
SSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${PROD_SSH_KEY:+-i ${PROD_SSH_KEY}} -p ${PROD_PORT} root@${PROD_HOST}"
SCP="scp -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${PROD_SSH_KEY:+-i ${PROD_SSH_KEY}} -P ${PROD_PORT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/pwsats-prod-backup-${TIMESTAMP}.sql.gz"
DATE_FILE="${BACKUP_DIR}/pwsats-prod-backup-${DATE_ONLY}.sql.gz"

log "═══════════════════════════════════════════"
log "Production Database Backup"
log "  Host:     ${PROD_HOST}:${PROD_PORT}"
log "  DB:       ${DB_NAME} (user: ${DB_USER})"
log "  Output:   ${BACKUP_FILE}"
log "═══════════════════════════════════════════"

# Step 1: Verify SSH connectivity
log "Checking SSH connectivity..."
${SSH} "true" 2>/dev/null || die "Cannot SSH to ${PROD_HOST}:${PROD_PORT}. Check key and network."

# Step 2: Run pg_dump on production, pipe through gzip, save locally
log "Running pg_dump on production..."
# Use sudo -u postgres for full access (pg_dump via Unix socket).
# The "could not change directory to /root" warning is harmless — suppressed.
if ${SSH} "sudo -u postgres pg_dump --clean --if-exists --create --no-owner --no-acl ${DB_NAME}" 2>/dev/null \
   | gzip > "${BACKUP_FILE}"; then
  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  log "✓ Dump saved: ${SIZE} → ${BACKUP_FILE}"
else
  die "pg_dump failed on production server."
fi

# Step 3: Create date-based symlink-style copy (for easy restore by date)
# Keep one file per day — if multiple backups on same day, last one wins
cp "${BACKUP_FILE}" "${DATE_FILE}"
log "Date backup: ${DATE_FILE}"

# Step 4: Remove backups older than $RETENTION_DAYS
DELETED=0
while IFS= read -r old_file; do
  log "Removing old backup: $(basename "$old_file")"
  rm -f "$old_file"
  ((DELETED++))
done < <(find "${BACKUP_DIR}" -name "pwsats-prod-backup-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" 2>/dev/null)

# Count remaining backups
TOTAL=$(find "${BACKUP_DIR}" -name "pwsats-prod-backup-*.sql.gz" -type f | wc -l)

log "═══════════════════════════════════════════"
log "✓ Backup complete!"
log "  File:      ${BACKUP_FILE}"
log "  Old files: ${DELETED} removed (> ${RETENTION_DAYS} days)"
log "  Total:     ${TOTAL} backups on disk"
log "═══════════════════════════════════════════"
