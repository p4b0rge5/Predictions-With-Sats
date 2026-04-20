#!/usr/bin/env bash
# =============================================================================
# Build & Deploy — Predictions With Sats
# =============================================================================
# Uso:
#   ./scripts/build-deploy.sh          # rebuild completo + restart
#   ./scripts/build-deploy.sh api      # rebuild só o api-server + restart
#   ./scripts/build-deploy.sh web      # rebuild só o frontend + restart
#   ./scripts/build-deploy.sh restart  # restart sem rebuild (usa build atual)
#   ./scripts/build-deploy.sh status   # status dos serviços
#   ./scripts/build-deploy.sh logs     # tail dos logs
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

log() { printf '\033[1;34m[build-deploy]\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; }

service_restart() {
  if systemctl --user is-enabled pwsats-tunnel.service &>/dev/null; then
    log "Reiniciando via systemd (pwsats-tunnel.service)..."
    systemctl --user restart pwsats-tunnel.service
    ok "Serviço reiniciado."
  else
    log "systemd unit não encontrada. Usando start-services.sh..."
    "$ROOT_DIR/scripts/start-services.sh" restart
  fi
}

service_status() {
  if systemctl --user is-enabled pwsats-tunnel.service &>/dev/null; then
    systemctl --user status pwsats-tunnel.service --no-pager
  else
    "$ROOT_DIR/scripts/start-services.sh" status
  fi
}

service_logs() {
  if systemctl --user is-enabled pwsats-tunnel.service &>/dev/null; then
    journalctl --user -u pwsats-tunnel.service -n 100 -f
  else
    "$ROOT_DIR/scripts/start-services.sh" logs
  fi
}

# -----------------------------------------------------------------------------
# Build targets
# -----------------------------------------------------------------------------

build_libs() {
  log "Buildando libs compartilhadas (api-zod, api-client-react)..."
  cd "$ROOT_DIR"
  pnpm --filter @workspace/api-zod         run build 2>/dev/null || true
  pnpm --filter @workspace/api-client-react run build 2>/dev/null || true
  ok "Libs OK"
}

build_api() {
  log "Buildando api-server (esbuild → dist/index.mjs)..."
  cd "$ROOT_DIR"
  pnpm --filter @workspace/api-server run build
  ok "api-server OK → artifacts/api-server/dist/index.mjs"
}

build_web() {
  log "Buildando frontend (vite build)..."
  cd "$ROOT_DIR"
  pnpm --filter @workspace/predictions-with-sats-web run build
  ok "Frontend OK → artifacts/predictions-with-sats-web/dist/"
}

build_all() {
  log "Typecheck global..."
  cd "$ROOT_DIR"
  pnpm run typecheck
  build_api
  build_web
}

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------

CMD="${1:-all}"

case "$CMD" in
  all)
    log "=== BUILD COMPLETO ==="
    build_all
    service_restart
    ok "Deploy concluído."
    ;;
  api)
    log "=== REBUILD API ==="
    build_api
    service_restart
    ok "Deploy da API concluído."
    ;;
  web)
    log "=== REBUILD FRONTEND ==="
    build_web
    service_restart
    ok "Deploy do frontend concluído."
    ;;
  restart)
    log "=== RESTART (sem rebuild) ==="
    service_restart
    ;;
  status)
    service_status
    ;;
  logs)
    service_logs
    ;;
  -h|--help|help)
    sed -n '3,10p' "$0"
    ;;
  *)
    err "Comando desconhecido: $CMD"
    sed -n '3,10p' "$0"
    exit 1
    ;;
esac
