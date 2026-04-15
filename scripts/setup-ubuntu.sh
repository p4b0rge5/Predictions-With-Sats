#!/usr/bin/env bash

set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  echo "Unable to detect Linux distribution: /etc/os-release not found." >&2
  exit 1
fi

if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"ubuntu"* && "${ID_LIKE:-}" != *"debian"* ]]; then
  echo "This setup script is intended for Ubuntu/Debian systems." >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "sudo is required to install system packages. Re-run as root or install sudo." >&2
  exit 1
fi

log() {
  printf '\n==> %s\n' "$1"
}

need_command() {
  command -v "$1" >/dev/null 2>&1
}

current_node_major() {
  if ! need_command node; then
    echo ""
    return
  fi

  local raw
  raw="$(node -p 'process.versions.node.split(".")[0]')"
  printf '%s' "${raw#v}"
}

install_apt_packages() {
  log "Updating apt package index"
  ${SUDO} apt-get update

  log "Installing base system dependencies"
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    pkg-config \
    postgresql \
    postgresql-client \
    postgresql-contrib \
    python3
}

install_node() {
  local installed_major
  installed_major="$(current_node_major)"

  if [[ -n "${installed_major}" && "${installed_major}" == "${NODE_MAJOR}" ]]; then
    log "Node.js ${NODE_MAJOR} already installed"
    return
  fi

  log "Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | ${SUDO} -E bash -
  ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

install_pnpm() {
  if ! need_command corepack; then
    echo "corepack is not available after Node.js installation." >&2
    exit 1
  fi

  log "Enabling corepack and activating pnpm ${PNPM_VERSION}"
  ${SUDO} corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

install_workspace_dependencies() {
  if ! need_command pnpm; then
    echo "pnpm is not available on PATH." >&2
    exit 1
  fi

  log "Installing workspace dependencies with pnpm"
  cd "${REPO_ROOT}"
  pnpm install --frozen-lockfile
}

print_summary() {
  local node_version
  local pnpm_version

  node_version="$(node --version)"
  pnpm_version="$(pnpm --version)"

  cat <<EOF

Setup complete.

Installed:
  Node.js: ${node_version}
  pnpm:    ${pnpm_version}

Next steps:
  1. Set the required environment variables, especially DATABASE_URL, ALBY_API_TOKEN,
     LIGHTNING_ADDRESS, WEBHOOK_SECRET, PORT, COINOS_JWT_TOKEN, and API_FOOTBALL_KEY.
  2. Create/configure PostgreSQL if this machine will run the backend database.
  3. Run: pnpm --filter @workspace/db run push
  4. Run: pnpm run build
EOF
}

install_apt_packages
install_node
install_pnpm
install_workspace_dependencies
print_summary
