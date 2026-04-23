#!/usr/bin/env bash
# =============================================================================
# Predictions With Sats — Instalação de Ambiente de Desenvolvimento
# =============================================================================
# Uso:
#    bash scripts/install-clean-dev.sh [--with-tor]
#
# Pré-requisitos:
#    - Ubuntu 22.04+ ou Debian 12+ (máquina local ou VPS de dev)
#    - Executar como root (ou via sudo)
#    - O arquivo .env já configurado na raiz do repositório
#    - Acesso à internet para download de pacotes
#
# Diferenças em relação à produção (install-clean.sh):
#    - SEM nginx / Let's Encrypt / domínio público
#    - SEM serviço systemd system-wide (usa modo de processo local)
#    - COM cloudflared quick tunnel (gera URL HTTPS automática — sem token)
#    - PUBLIC_BASE_URL e WEBHOOK_URL são atualizados dinamicamente pelo tunnel
#    - Tor opcional via flag --with-tor
#    - Serviços sobem em modo dev (Vite HMR + API watch)
#
# O que o script faz:
#    1. Instala Node.js 24, pnpm, PostgreSQL, cloudflared
#    2. (Opcional) Configura Git via Tor
#    3. Instala dependências do workspace
#    4. Compila libs + API + frontend
#    5. Cria o usuário/banco PostgreSQL a partir do DATABASE_URL no .env
#    6. Aplica as migrações do banco (drizzle push)
#    7. Instala o systemd user unit pwsats-tunnel.service
#    8. Inicia os serviços (API dev + Vite dev + cloudflared quick tunnel)
#    9. Smoke test no localhost
# =============================================================================

set -euo pipefail

# --- Flags -------------------------------------------------------------------

WITH_TOR=false
for arg in "$@"; do
  case "$arg" in
    --with-tor) WITH_TOR=true ;;
  esac
done

# --- Constantes --------------------------------------------------------------

NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"
APP_PORT="${APP_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

API_DIST="${REPO_ROOT}/artifacts/api-server/dist/index.mjs"
FRONTEND_DIST="${REPO_ROOT}/artifacts/predictions-with-sats-web/dist/public"

SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SYSTEMD_UNIT_SRC="${REPO_ROOT}/ops/systemd/pwsats-tunnel.service"

# --- Helpers -----------------------------------------------------------------

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "Execute como root: sudo bash scripts/install-clean-dev.sh"
    exit 1
  fi
}

require_env_file() {
  if [[ ! -f "${REPO_ROOT}/.env" ]]; then
    err "Arquivo .env não encontrado em ${REPO_ROOT}/.env"
    info ""
    info "Crie o .env copiando o template e preenchendo as variáveis:"
    info "  cp ${REPO_ROOT}/.env.dev.example ${REPO_ROOT}/.env"
    info ""
    info "Variáveis obrigatórias:"
    info "  DATABASE_URL   — string de conexão PostgreSQL"
    info "  ALBY_API_TOKEN — token da API Alby"
    info "  LIGHTNING_ADDRESS — endereço Lightning para receber pagamentos"
    info "  WEBHOOK_SECRET — segredo HMAC para verificar webhooks Alby"
    info "  SESSION_SECRET — segredo de sessão (base64, qualquer string longa)"
    info "  COINOS_JWT_TOKEN, COINOS_USERNAME, COINOS_PASSWORD — credenciais Coinos"
    info "  API_FOOTBALL_KEY — chave da API de esportes"
    exit 1
  fi
  ok ".env encontrado."
}

check_os() {
  if [[ ! -f /etc/os-release ]]; then
    err "Não foi possível detectar a distribuição Linux."
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
    err "Este script suporta apenas Ubuntu e Debian."
    exit 1
  fi
  ok "Sistema: ${PRETTY_NAME:-$ID}"
}

# --- Pacotes do sistema -------------------------------------------------------

install_apt_packages() {
  log "Instalando dependências do sistema"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential ca-certificates curl git gnupg lsb-release \
    openssl pkg-config \
    postgresql postgresql-client postgresql-contrib \
    python3

  if [[ "${WITH_TOR}" == "true" ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y tor
    systemctl enable tor
    systemctl start tor
    ok "Pacotes instalados + Tor habilitado."
  else
    ok "Pacotes do sistema instalados."
  fi
}

# --- Cloudflared (quick tunnel — sem domínio) --------------------------------

install_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    ok "cloudflared já instalado ($(cloudflared --version 2>&1 | head -1))."
    return
  fi

  log "Instalando cloudflared"
  local arch
  arch="$(dpkg --print-architecture)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
  ok "cloudflared instalado ($(cloudflared --version 2>&1 | head -1))."
}

# --- Configuração Git via Tor (opcional) -------------------------------------

setup_git_tor_proxy() {
  if [[ "${WITH_TOR}" != "true" ]]; then
    info "Tor desativado — Git usará conexão direta."
    info "Para habilitar: bash scripts/install-clean-dev.sh --with-tor"
    return
  fi

  log "Configurando Git via Tor"
  sleep 2
  git config --global http.proxy 'socks5h://127.0.0.1:9050'

  info "Verificando conectividade anônima com GitHub..."
  if curl --socks5-hostname 127.0.0.1:9050 -s --max-time 15 https://github.com >/dev/null; then
    ok "Git-over-Tor confirmado."
  else
    warn "Tor configurado, mas teste de conexão falhou (pode ser latência alta)."
  fi
}

# --- Node.js -----------------------------------------------------------------

install_nodejs() {
  local installed_major=""
  if command -v node >/dev/null 2>&1; then
    installed_major="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || true)"
  fi

  if [[ "${installed_major:-}" == "${NODE_MAJOR}" ]]; then
    ok "Node.js ${NODE_MAJOR} já instalado ($(node --version))."
    return
  fi

  log "Instalando Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  ok "Node.js $(node --version) instalado."
}

# --- pnpm --------------------------------------------------------------------

install_pnpm() {
  local installed_pnpm=""
  if command -v pnpm >/dev/null 2>&1; then
    installed_pnpm="$(pnpm --version 2>/dev/null || true)"
  fi

  if [[ "${installed_pnpm:-}" == "${PNPM_VERSION}" ]]; then
    ok "pnpm ${PNPM_VERSION} já instalado."
    return
  fi

  log "Configurando pnpm ${PNPM_VERSION} via corepack"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  ok "pnpm $(pnpm --version) disponível."
}

# --- Dependências do workspace -----------------------------------------------

install_dependencies() {
  log "Instalando dependências do workspace (pnpm install)"
  cd "${REPO_ROOT}"
  pnpm install --frozen-lockfile
  ok "Dependências instaladas."
}

# --- Build -------------------------------------------------------------------

build_project() {
  log "Compilando o projeto"
  cd "${REPO_ROOT}"

  info "Libs compartilhadas (api-zod, api-client-react)..."
  pnpm --filter @workspace/api-zod          run build 2>/dev/null || true
  pnpm --filter @workspace/api-client-react run build 2>/dev/null || true

  info "API (esbuild → dist/index.mjs)..."
  pnpm --filter @workspace/api-server run build

  info "Frontend (vite build)..."
  pnpm --filter @workspace/predictions-with-sats-web run build

  ok "Build concluído."
  info "API:      ${API_DIST}"
  info "Frontend: ${FRONTEND_DIST}"
}

# --- PostgreSQL --------------------------------------------------------------

setup_postgresql() {
  log "Configurando PostgreSQL"

  systemctl enable postgresql
  systemctl start postgresql

  local db_url db_user db_pass db_name
  db_url="$(grep -E '^DATABASE_URL=' "${REPO_ROOT}/.env" | head -1 | cut -d'=' -f2- | tr -d '"' || true)"

  if [[ -z "${db_url}" ]]; then
    err "DATABASE_URL não encontrado no .env"
    exit 1
  fi

  db_user="$(printf '%s' "${db_url}" | sed -E 's|postgresql://([^:]+):.*|\1|')"
  db_pass="$(printf '%s' "${db_url}" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')"
  db_name="$(printf '%s' "${db_url}" | sed -E 's|.*/([^?]+).*|\1|')"

  info "Banco: ${db_name}  Usuário: ${db_user}"

  su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${db_user}'\" | grep -q 1 || \
    psql -c \"CREATE ROLE \\\"${db_user}\\\" WITH LOGIN PASSWORD '${db_pass}'\"" 2>&1

  su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\" | grep -q 1 || \
    psql -c \"CREATE DATABASE \\\"${db_name}\\\" OWNER \\\"${db_user}\\\"\"" 2>&1

  ok "PostgreSQL: banco '${db_name}', usuário '${db_user}'."
}

# --- Migrações ---------------------------------------------------------------

run_migrations() {
  log "Aplicando migrações do banco de dados (drizzle push)"
  cd "${REPO_ROOT}"
  # shellcheck disable=SC1091
  set -a; source "${REPO_ROOT}/.env"; set +a
  pnpm --filter @workspace/db run push
  ok "Migrações aplicadas."
}

# --- Systemd user unit -------------------------------------------------------
# Instala o unit de usuário para manter os serviços rodando entre reinicializações.
# O unit usa start-tunnel.ts que sobe API + Vite + cloudflared quick tunnel.

install_systemd_user_unit() {
  log "Instalando systemd user unit"

  # Determina o usuário real (pode ser root ou um usuário com sudo)
  local real_user="${SUDO_USER:-root}"
  local real_home
  real_home="$(getent passwd "${real_user}" | cut -d: -f6)"

  local unit_dir="${real_home}/.config/systemd/user"
  local unit_dest="${unit_dir}/pwsats-tunnel.service"

  mkdir -p "${unit_dir}"

  if [[ ! -f "${SYSTEMD_UNIT_SRC}" ]]; then
    warn "Arquivo ${SYSTEMD_UNIT_SRC} não encontrado — gerando unit padrão."

    local node_bin
    node_bin="$(command -v node)"
    local pnpm_bin
    pnpm_bin="$(command -v pnpm)"

    cat > "${unit_dest}" <<UNITEOF
[Unit]
Description=Predictions With Sats — Dev Services (API + Vite + Tunnel)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
ExecStart=${pnpm_bin} run start:tunnel
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pwsats-tunnel

[Install]
WantedBy=default.target
UNITEOF
  else
    # Copia o unit do repo, ajustando o WorkingDirectory para este repo_root
    sed "s|WorkingDirectory=.*|WorkingDirectory=${REPO_ROOT}|g" \
      "${SYSTEMD_UNIT_SRC}" > "${unit_dest}"
  fi

  # Se estiver rodando como root mas para outro usuário, ajusta ownership
  if [[ "${real_user}" != "root" ]]; then
    chown "${real_user}:${real_user}" "${unit_dest}"
  fi

  # Recarrega systemd do usuário e habilita o unit
  if [[ "${real_user}" == "root" ]]; then
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable pwsats-tunnel.service 2>/dev/null || true
  else
    # Habilita linger ANTES para que o systemd inicie o user instance
    loginctl enable-linger "${real_user}" 2>/dev/null || true
    ok "loginctl linger habilitado para '${real_user}'."

    local real_uid
    real_uid="$(id -u "${real_user}")"
    local xdg_runtime="/run/user/${real_uid}"

    # Aguarda o runtime dir ser criado pelo systemd-logind (até 10 s)
    local wait_count=0
    while [[ ! -d "${xdg_runtime}" && $wait_count -lt 10 ]]; do
      sleep 1
      wait_count=$((wait_count + 1))
    done

    # Cria o symlink de enable manualmente — mais confiável do que systemctl --user enable em contexto su
    mkdir -p "${unit_dir}/default.target.wants"
    ln -sf "${unit_dest}" "${unit_dir}/default.target.wants/pwsats-tunnel.service"
    chown -R "${real_user}:${real_user}" "${unit_dir}"

    if [[ -d "${xdg_runtime}" ]]; then
      su - "${real_user}" -c \
        "XDG_RUNTIME_DIR=${xdg_runtime} DBUS_SESSION_BUS_ADDRESS=unix:path=${xdg_runtime}/bus systemctl --user daemon-reload" 2>/dev/null || true
    else
      warn "Runtime dir ${xdg_runtime} não encontrado — daemon-reload será feito no próximo login."
    fi
  fi

  ok "Systemd user unit instalado em ${unit_dest}."
}

# --- Iniciar serviços --------------------------------------------------------

start_dev_services() {
  log "Iniciando serviços de desenvolvimento"

  local real_user="${SUDO_USER:-root}"

  info "Modo: cloudflared quick tunnel (URL HTTPS gerada automaticamente)"
  info "API: http://localhost:${APP_PORT}"
  info "Frontend: http://localhost:${FRONTEND_PORT}"

  if [[ "${real_user}" == "root" ]]; then
    systemctl --user restart pwsats-tunnel.service 2>/dev/null || \
      "${SCRIPT_DIR}/start-services.sh" restart
  else
    local real_uid
    real_uid="$(id -u "${real_user}")"
    local xdg_runtime="/run/user/${real_uid}"

    su - "${real_user}" -c \
      "XDG_RUNTIME_DIR=${xdg_runtime} DBUS_SESSION_BUS_ADDRESS=unix:path=${xdg_runtime}/bus systemctl --user restart pwsats-tunnel.service" 2>/dev/null || \
      "${SCRIPT_DIR}/start-services.sh" restart
  fi

  sleep 5
}

# --- Smoke test --------------------------------------------------------------

smoke_test() {
  log "Verificação final (localhost)"

  local max_attempts=10
  local attempt=0
  local health=""

  info "Aguardando API subir na porta ${APP_PORT}..."
  while [[ $attempt -lt $max_attempts ]]; do
    health="$(curl -sf "http://localhost:${APP_PORT}/api/healthz" 2>/dev/null || true)"
    if [[ "${health}" == *'"ok"'* ]]; then
      ok "API respondendo: ${health}"
      break
    fi
    attempt=$((attempt + 1))
    sleep 3
  done

  if [[ "${health}" != *'"ok"'* ]]; then
    warn "API não respondeu ao health check após ${max_attempts} tentativas."
    warn "Verifique os logs: bash scripts/start-services.sh logs"
  fi
}

# --- Template .env para desenvolvimento --------------------------------------

generate_env_example() {
  local example_file="${REPO_ROOT}/.env.dev.example"

  if [[ -f "${example_file}" ]]; then
    return
  fi

  log "Gerando template .env.dev.example"

  cat > "${example_file}" <<'ENVEOF'
# =============================================================================
# Predictions With Sats — Template .env para Desenvolvimento
# =============================================================================
# Copie este arquivo para .env e preencha os valores antes de instalar:
#   cp .env.dev.example .env
#
# Diferenças do ambiente de desenvolvimento:
#   - PUBLIC_BASE_URL e WEBHOOK_URL são deixados em branco e preenchidos
#     automaticamente pelo cloudflared quick tunnel ao iniciar os serviços.
#   - NODE_ENV=development
# =============================================================================

# -----------------------------------------------------------------------------
# Core runtime
# -----------------------------------------------------------------------------
PORT=3001
NODE_ENV=development
BASE_PATH=/
LOG_LEVEL=debug

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------
# Ajuste usuário, senha e nome do banco conforme necessário.
DATABASE_URL="postgresql://pwsats:sua_senha_aqui@localhost:5432/pwsats_db_dev"

# -----------------------------------------------------------------------------
# Incoming Lightning payments (Alby)
# -----------------------------------------------------------------------------
ALBY_API_TOKEN="seu_token_alby_aqui"
LIGHTNING_ADDRESS="seunome@coinos.io"
WEBHOOK_SECRET="sua_senha_webhook_aqui"

# Deixe em branco — preenchido automaticamente pelo cloudflared quick tunnel.
WEBHOOK_URL=
PUBLIC_BASE_URL=

# -----------------------------------------------------------------------------
# Outgoing Lightning payouts (Coinos)
# -----------------------------------------------------------------------------
COINOS_JWT_TOKEN="seu_jwt_coinos_aqui"
COINOS_USERNAME="seu_usuario_coinos"
COINOS_PASSWORD="sua_senha_coinos"

# -----------------------------------------------------------------------------
# External market data
# -----------------------------------------------------------------------------
API_FOOTBALL_KEY="sua_chave_api_football_aqui"

# -----------------------------------------------------------------------------
# Session
# -----------------------------------------------------------------------------
# Gere com: openssl rand -base64 48
SESSION_SECRET="gere_uma_string_aleatoria_longa_aqui"

# -----------------------------------------------------------------------------
# Cloudflare Named Tunnel (opcional — para URL permanente em dev)
# Se deixado em branco, usa quick tunnel com URL temporária.
# -----------------------------------------------------------------------------
# CLOUDFLARED_TUNNEL_TOKEN=<token-do-cloudflare-zero-trust>
# TUNNEL_PUBLIC_BASE_URL=https://seu-dominio-dev.com
ENVEOF

  ok "Template gerado em ${example_file}"
}

# --- Resumo ------------------------------------------------------------------

print_summary() {
  local real_user="${SUDO_USER:-root}"

  cat <<SUMMARY

╔══════════════════════════════════════════════════════════════════╗
║    Predictions With Sats — Ambiente de Desenvolvimento Pronto    ║
╚══════════════════════════════════════════════════════════════════╝

  Node.js:    $(node --version)
  pnpm:       $(pnpm --version)
  cloudflared: $(cloudflared --version 2>&1 | head -1)
  Tor proxy:  ${WITH_TOR}
  Repo:       ${REPO_ROOT}

──────────────────────────────────────────────────────────────────
  ACESSO LOCAL:
──────────────────────────────────────────────────────────────────
  API:        http://localhost:${APP_PORT}/api/healthz
  Frontend:   http://localhost:${FRONTEND_PORT}

──────────────────────────────────────────────────────────────────
  ACESSO EXTERNO (cloudflared quick tunnel):
──────────────────────────────────────────────────────────────────
  A URL pública HTTPS é gerada automaticamente pelo cloudflared
  e atualizada no .env (PUBLIC_BASE_URL) ao iniciar os serviços.
  Verifique nos logs:
    bash ${REPO_ROOT}/scripts/start-services.sh logs

  IMPORTANTE: A URL muda a cada reinicialização do tunnel.
  Para URL permanente, configure CLOUDFLARED_TUNNEL_TOKEN no .env.

──────────────────────────────────────────────────────────────────
  O QUE NÃO FUNCIONA EM DESENVOLVIMENTO:
──────────────────────────────────────────────────────────────────
  ✗  pwsats.com / www.pwsats.com (domínio só existe em produção)
  ✗  Certificado SSL fixo (Let's Encrypt requer domínio público)
  ✗  nginx como reverse proxy (não instalado em dev)

──────────────────────────────────────────────────────────────────
  COMANDOS ÚTEIS:
──────────────────────────────────────────────────────────────────
  Status:      bash ${REPO_ROOT}/scripts/start-services.sh status
  Logs:        bash ${REPO_ROOT}/scripts/start-services.sh logs
  Parar:       bash ${REPO_ROOT}/scripts/start-services.sh stop
  Reiniciar:   bash ${REPO_ROOT}/scripts/start-services.sh restart
  Rebuild:     bash ${REPO_ROOT}/scripts/build-deploy.sh [all|api|web]

──────────────────────────────────────────────────────────────────
  WORKFLOW DE DESENVOLVIMENTO:
──────────────────────────────────────────────────────────────────
  1. Edite o código
  2. Para rebuild e restart:
       bash scripts/build-deploy.sh api   # só API
       bash scripts/build-deploy.sh web   # só frontend
       bash scripts/build-deploy.sh all   # tudo

──────────────────────────────────────────────────────────────────
SUMMARY
}

# --- Entrypoint --------------------------------------------------------------

require_root
generate_env_example
require_env_file
check_os
install_apt_packages
setup_git_tor_proxy
install_nodejs
install_pnpm
install_cloudflared
install_dependencies
build_project
setup_postgresql
run_migrations
install_systemd_user_unit
start_dev_services
smoke_test
print_summary

