#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_FILE="$RUNTIME_DIR/start-tunnel.pid"
LOG_FILE="$LOG_DIR/start-tunnel.log"
SYSTEMD_UNIT="pwsats-tunnel.service"

mkdir -p "$LOG_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/start-services.sh [start|stop|restart|status|logs] [-- extra args]

Commands:
  start     Start API, frontend, and tunnel
  stop      Stop the managed service stack
  restart   Restart the managed service stack
  status    Show whether the managed service stack is running
  logs      Tail service logs

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

remove_stale_pid() {
  if [[ -f "$PID_FILE" ]] && ! is_running; then
    rm -f "$PID_FILE"
  fi
}

start_services() {
  local extra_args=("$@")
  local escaped_args=""

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

  printf 'Starting services. Log: %s\n' "$LOG_FILE"
  nohup bash -lc "cd '$ROOT_DIR/scripts' && exec node --import tsx ./src/start-tunnel.ts${escaped_args}" \
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
      return 0
    fi
    sleep 1
  done

  printf 'Force stopping services (pid %s)\n' "$pid"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
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
    return 0
  fi

  printf 'Services stopped\n'
  printf 'Log file: %s\n' "$LOG_FILE"
  return 1
}

tail_logs() {
  if has_systemd_unit; then
    exec journalctl --user -u "$SYSTEMD_UNIT" -n 100 -f
  fi

  touch "$LOG_FILE"
  exec tail -n 100 -f "$LOG_FILE"
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
