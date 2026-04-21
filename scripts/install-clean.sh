#!/usr/bin/env bash
# =============================================================================
# Predictions With Sats — Instalação Limpa (sem intervenção)
# =============================================================================
# Uso:
#   bash scripts/install-clean.sh
#
# Pré-requisitos:
#   - Ubuntu 22.04+ ou Debian 12+
#   - Executar como root (ou via sudo)
#   - O arquivo .env já configurado na raiz do repositório
#   - Acesso à internet para download de pacotes
#
# O script faz:
#   1. Instala pacotes do sistema (Node.js 24, pnpm, PostgreSQL, nginx)
#   2. Instala dependências do workspace (pnpm install)
#   3. Compila a API e o frontend
#   4. Cria o usuário/banco PostgreSQL a partir do DATABASE_URL no .env
#   5. Aplica as migrações do banco (drizzle push)
#   6. Configura nginx como reverse proxy
#   7. Corrige permissão do /root para o nginx (www-data) acessar os arquivos
#   8. Cria e inicia o serviço systemd pwsats-api
# =============================================================================

set -euo pipefail

# --- Constantes --------------------------------------------------------------

NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"
APP_PORT="${APP_PORT:-3001}"
SERVICE_NAME="pwsats-api"
NGINX_SITE="pwsats"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FRONTEND_DIST="${REPO_ROOT}/artifacts/predictions-with-sats-web/dist/public"
API_DIST="${REPO_ROOT}/artifacts/api-server/dist/index.mjs"

# --- Helpers -----------------------------------------------------------------

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; }
info() { printf '    %s\n' "$*"; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "Execute como root: sudo bash scripts/install-clean.sh"
    exit 1
  fi
}

require_env_file() {
  if [[ ! -f "${REPO_ROOT}/.env" ]]; then
    err "Arquivo .env não encontrado em ${REPO_ROOT}/.env"
    err "Coloque o .env configurado na raiz do repositório antes de instalar."
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
    nginx openssl pkg-config \
    postgresql postgresql-client postgresql-contrib \
    python3
  ok "Pacotes do sistema instalados."
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
  pnpm --filter @workspace/api-zod         run build 2>/dev/null || true
  pnpm --filter @workspace/api-client-react run build 2>/dev/null || true

  info "API (esbuild → dist/index.mjs)..."
  pnpm --filter @workspace/api-server run build

  info "Frontend (vite build)..."
  NODE_ENV=production pnpm --filter @workspace/predictions-with-sats-web run build

  ok "Build concluído."
  info "API:      ${API_DIST}"
  info "Frontend: ${FRONTEND_DIST}"
}

# --- PostgreSQL --------------------------------------------------------------

setup_postgresql() {
  log "Configurando PostgreSQL"

  systemctl enable postgresql
  systemctl start postgresql

  # Ler credenciais do .env
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

  # Criar role se não existir
  su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${db_user}'\" | grep -q 1 || \
    psql -c \"CREATE ROLE \\\"${db_user}\\\" WITH LOGIN PASSWORD '${db_pass}'\"" 2>&1

  # Criar banco se não existir
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

# --- Permissões nginx --------------------------------------------------------

fix_root_permissions() {
  log "Ajustando permissão de /root para nginx (www-data)"
  # O nginx roda como www-data e precisa de execute em /root para traversal.
  # chmod o+x adiciona permissão de traversal sem expor o conteúdo do diretório.
  chmod o+x /root
  ok "Permissão de traversal em /root ajustada (modo: $(stat -c '%a' /root))."
}

# --- Nginx -------------------------------------------------------------------

setup_nginx() {
  log "Configurando nginx"

  local nginx_conf="/etc/nginx/sites-available/${NGINX_SITE}"

  cat > "${nginx_conf}" <<NGINXEOF
server {
    listen 80;
    server_name _;

    root ${FRONTEND_DIST};
    index index.html;

    proxy_read_timeout    60s;
    proxy_connect_timeout 10s;
    proxy_send_timeout    60s;

    # Proxy da API
    location /api/ {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # SPA: redireciona rotas para index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache de assets estáticos
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}
NGINXEOF

  ln -sf "${nginx_conf}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
  rm -f /etc/nginx/sites-enabled/default

  nginx -t
  systemctl enable nginx
  systemctl reload nginx 2>/dev/null || systemctl start nginx

  ok "nginx configurado (porta 80)."
}

# --- Serviço systemd ---------------------------------------------------------

setup_systemd() {
  log "Criando serviço systemd: ${SERVICE_NAME}"

  local node_bin
  node_bin="$(command -v node)"
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"

  cat > "${service_file}" <<UNITEOF
[Unit]
Description=Predictions With Sats — API Server
After=network.target postgresql.service
Wants=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${REPO_ROOT}/artifacts/api-server

ExecStart=/bin/bash -c 'set -a; source ${REPO_ROOT}/.env; set +a; exec ${node_bin} --enable-source-maps ${API_DIST}'

Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNITEOF

  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  ok "Serviço '${SERVICE_NAME}' instalado e habilitado."
}

# --- Iniciar serviço ---------------------------------------------------------

start_service() {
  log "Iniciando o serviço ${SERVICE_NAME}"

  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    info "Serviço já em execução. Reiniciando..."
    systemctl restart "${SERVICE_NAME}"
  else
    systemctl start "${SERVICE_NAME}"
  fi

  sleep 3

  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    ok "Serviço '${SERVICE_NAME}' em execução."
  else
    err "Falha ao iniciar o serviço. Verifique: journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
  fi
}

# --- Verificação final -------------------------------------------------------

smoke_test() {
  log "Verificação final"

  local health
  health="$(curl -sf http://localhost/api/healthz 2>/dev/null || true)"
  if [[ "${health}" == *'"ok"'* ]]; then
    ok "API respondendo: ${health}"
  else
    err "API não respondeu ao health check. Verifique: journalctl -u ${SERVICE_NAME} -f"
    exit 1
  fi

  local frontend_code
  frontend_code="$(curl -so /dev/null -w '%{http_code}' http://localhost/ 2>/dev/null || true)"
  if [[ "${frontend_code}" == "200" ]]; then
    ok "Frontend respondendo (HTTP ${frontend_code})."
  else
    err "Frontend retornou HTTP ${frontend_code}. Verifique nginx: journalctl -u nginx -n 20"
    exit 1
  fi
}

# --- Resumo ------------------------------------------------------------------

print_summary() {
  cat <<SUMMARY

╔══════════════════════════════════════════════════════════════════╗
║      Predictions With Sats — Instalação Concluída              ║
╚══════════════════════════════════════════════════════════════════╝

  Node.js:   $(node --version)
  pnpm:      $(pnpm --version)
  Serviço:   ${SERVICE_NAME}
  Repo:      ${REPO_ROOT}

──────────────────────────────────────────────────────────────────
  APLICAÇÃO:
──────────────────────────────────────────────────────────────────
  Frontend:  http://localhost
  API:       http://localhost/api/healthz

──────────────────────────────────────────────────────────────────
  COMANDOS ÚTEIS:
──────────────────────────────────────────────────────────────────
  Status:     systemctl status ${SERVICE_NAME}
  Logs:       journalctl -u ${SERVICE_NAME} -f
  Parar:      systemctl stop ${SERVICE_NAME}
  Reiniciar:  systemctl restart ${SERVICE_NAME}
  Rebuild:    bash ${REPO_ROOT}/scripts/build-deploy.sh

──────────────────────────────────────────────────────────────────
SUMMARY
}

# --- Entrypoint --------------------------------------------------------------

require_root
require_env_file
check_os
install_apt_packages
install_nodejs
install_pnpm
install_dependencies
build_project
setup_postgresql
run_migrations
fix_root_permissions
setup_nginx
setup_systemd
start_service
smoke_test
print_summary
