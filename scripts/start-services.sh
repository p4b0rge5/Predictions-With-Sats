#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_FILE="$RUNTIME_DIR/start-tunnel.pid"
LOG_FILE="$LOG_DIR/start-tunnel.log"
OLLAMA_WEBUI_PID_FILE="$RUNTIME_DIR/ollama-webui-tunnel.pid"
OLLAMA_WEBUI_LOG_FILE="$LOG_DIR/ollama-webui-tunnel.log"
OLLAMA_WEBUI_PORT="${OLLAMA_WEBUI_PORT:-8080}"
SYSTEMD_UNIT="pwsats-tunnel.service"

mkdir -p "$LOG_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/start-services.sh [start|stop|restart|status|logs] [-- extra args]

Commands:
  start     Start API, frontend, tunnel, and Ollama WebUI tunnel
  stop      Stop the managed service stack (including Ollama WebUI tunnel)
  restart   Restart the managed service stack
  status    Show whether the managed service stack is running
  logs      Tail service logs

Environment:
  OLLAMA_WEBUI_PORT    Port for Ollama WebUI (default: 8080)

If the `pwsats-tunnel.service` user unit exists, this script uses systemd.
Otherwise it falls back to a local background process and PID file.

Extra args after `--` are only forwarded in local fallback mode.
EOF
}

has_systemd_unit() {
  command -v systemctl >/dev/null 2>&1 || return 1

  local load_state
  load_state="$(systemctl --user show "$SYSTEMD_UNIT" --property=LoadState --value 2>/dev/null || true)"
  [[ -n "$load_state" && "$load_state" != "not-found" ]]
}

service_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' <"$PID_FILE"
  fi
}

is_running() {
  local pid
  pid="$(service_pid || true)"

  if [[ -z "${pid:-}" ]]; then
    return 1
  fi

  kill -0 "$pid" 2>/dev/null
}

ollama_webui_tunnel_running() {
  if [[ -f "$OLLAMA_WEBUI_PID_FILE" ]]; then
    local pid
    pid="$(tr -d '[:space:]' <"$OLLAMA_WEBUI_PID_FILE" || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$OLLAMA_WEBUI_PID_FILE"
  fi
  return 1
}

remove_stale_pid() {
  if [[ -f "$PID_FILE" ]] && ! is_running; then
    rm -f "$PID_FILE"
  fi
}

start_ollama_webui_tunnel() {
  if ollama_webui_tunnel_running; then
    printf 'Ollama WebUI tunnel already running\n'
    return 0
  fi

  printf 'Starting Ollama WebUI tunnel (port %s)...\n' "$OLLAMA_WEBUI_PORT"
  nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$OLLAMA_WEBUI_PORT" \
    >>"$OLLAMA_WEBUI_LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" >"$OLLAMA_WEBUI_PID_FILE"

  sleep 3

  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'Ollama WebUI tunnel failed to start. Recent log:\n' >&2
    tail -n 20 "$OLLAMA_WEBUI_LOG_FILE" >&2 || true
    rm -f "$OLLAMA_WEBUI_PID_FILE"
    return 1
  fi

  printf 'Ollama WebUI tunnel started (pid %s)\n' "$pid"
}

start_services() {
  local extra_args=("$@")
  local escaped_args=""
  local start_cmd=""
  local path_cmd=""
  local node_bin=""
  local node_dir=""

  if has_systemd_unit; then
    printf 'Starting services via systemd unit %s\n' "$SYSTEMD_UNIT"
    systemctl --user start "$SYSTEMD_UNIT"
    systemctl --user is-active --quiet "$SYSTEMD_UNIT"
    printf 'Services started via systemd\n'
    return 0
  fi

  remove_stale_pid

  if is_running; then
    printf 'Services already running (pid %s)\n' "$(service_pid)"
    return 0
  fi

  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    printf 'Missing %s\n' "$ROOT_DIR/.env" >&2
    return 1
  fi

  if ((${#extra_args[@]} > 0)); then
    printf -v escaped_args ' %q' "${extra_args[@]}"
  fi

  if command -v node >/dev/null 2>&1; then
    node_bin="$(command -v node)"
    node_dir="$(dirname "$node_bin")"
  fi

  if [[ -n "$node_bin" && -f "$ROOT_DIR/scripts/node_modules/tsx/dist/cli.mjs" ]]; then
    printf -v start_cmd '%q %q %q' \
      "$node_bin" \
      "$ROOT_DIR/scripts/node_modules/tsx/dist/cli.mjs" \
      "$ROOT_DIR/scripts/src/start-tunnel.ts"
    printf -v path_cmd 'export PATH=%q:$PATH && ' "$node_dir"
  elif command -v pnpm >/dev/null 2>&1; then
    local pnpm_bin
    local pnpm_dir
    pnpm_bin="$(command -v pnpm)"
    pnpm_dir="$(dirname "$pnpm_bin")"
    printf -v start_cmd '%q --filter @workspace/scripts run start:tunnel' "$pnpm_bin"
    if [[ -n "$node_dir" ]]; then
      printf -v path_cmd 'export PATH=%q:%q:$PATH && ' "$pnpm_dir" "$node_dir"
    else
      printf -v path_cmd 'export PATH=%q:$PATH && ' "$pnpm_dir"
    fi
  elif [[ -x "$ROOT_DIR/scripts/node_modules/.bin/tsx" ]]; then
    printf -v start_cmd '%q %q' \
      "$ROOT_DIR/scripts/node_modules/.bin/tsx" \
      "$ROOT_DIR/scripts/src/start-tunnel.ts"
  else
    printf 'Neither pnpm nor local tsx binary is available. Run pnpm install first.\n' >&2
    return 1
  fi

  printf 'Starting services. Log: %s\n' "$LOG_FILE"
  nohup bash -lc "cd '$ROOT_DIR' && ${path_cmd}exec ${start_cmd}${escaped_args}" \
    >>"$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"

  sleep 3

  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'Service manager exited during startup. Recent log:\n' >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    return 1
  fi

  printf 'Services started (pid %s)\n' "$pid"

#  start_ollama_webui_tunnel
}

stop_services() {
  if has_systemd_unit; then
    printf 'Stopping services via systemd unit %s\n' "$SYSTEMD_UNIT"
    systemctl --user stop "$SYSTEMD_UNIT"
    printf 'Services stopped via systemd\n'
    return 0
  fi

  remove_stale_pid

  if ! is_running; then
    printf 'Services are not running\n'
    return 0
  fi

  local pid
  pid="$(service_pid)"

  printf 'Stopping services (pid %s)\n' "$pid"
  kill "$pid"

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      printf 'Services stopped\n'
      break
    fi
    sleep 1
  done

  if ollama_webui_tunnel_running; then
    local ollama_pid
    ollama_pid="$(tr -d '[:space:]' <"$OLLAMA_WEBUI_PID_FILE")"
    printf 'Stopping Ollama WebUI tunnel (pid %s)\n' "$ollama_pid"
    kill "$ollama_pid" 2>/dev/null || true
    rm -f "$OLLAMA_WEBUI_PID_FILE"
    printf 'Ollama WebUI tunnel stopped\n'
  fi
}

status_services() {
  if has_systemd_unit; then
    local main_pid
    main_pid="$(systemctl --user show "$SYSTEMD_UNIT" --property=MainPID --value 2>/dev/null || true)"

    if systemctl --user is-active --quiet "$SYSTEMD_UNIT"; then
      printf 'Services running via systemd (%s, pid %s)\n' "$SYSTEMD_UNIT" "${main_pid:-unknown}"
      return 0
    fi

    printf 'Services stopped via systemd (%s)\n' "$SYSTEMD_UNIT"
    return 1
  fi

  remove_stale_pid

  if is_running; then
    printf 'Services running (pid %s)\n' "$(service_pid)"
    printf 'Log file: %s\n' "$LOG_FILE"
  else
    printf 'Services stopped\n'
    printf 'Log file: %s\n' "$LOG_FILE"
  fi

  if ollama_webui_tunnel_running; then
    local ollama_pid
    ollama_pid="$(tr -d '[:space:]' <"$OLLAMA_WEBUI_PID_FILE")"
    printf 'Ollama WebUI tunnel running (pid %s)\n' "$ollama_pid"
    printf 'Ollama WebUI log: %s\n' "$OLLAMA_WEBUI_LOG_FILE"
#  else
#    printf 'Ollama WebUI tunnel stopped\n'
#    printf 'Ollama WebUI log: %s\n' "$OLLAMA_WEBUI_LOG_FILE"
  fi
}

tail_logs() {
  if has_systemd_unit; then
    exec journalctl --user -u "$SYSTEMD_UNIT" -n 100 -f
  fi

  touch "$LOG_FILE" "$OLLAMA_WEBUI_LOG_FILE"
  exec tail -n 100 -f "$LOG_FILE" "$OLLAMA_WEBUI_LOG_FILE"
}

command="${1:-start}"
shift || true

extra_args=()
if [[ "${1:-}" == "--" ]]; then
  shift
  extra_args=("$@")
fi

case "$command" in
  start)
    start_services "${extra_args[@]}"
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services "${extra_args[@]}"
    ;;
  status)
    status_services
    ;;
  logs)
    tail_logs
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
