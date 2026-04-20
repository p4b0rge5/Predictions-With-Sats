#!/usr/bin/env bash
# =============================================================================
# Predictions With Sats — Instalação para Produção
# =============================================================================
# Uso:
#   sudo ./scripts/install-production.sh
#
# Variáveis de ambiente opcionais:
#   NODE_MAJOR=24          Versão major do Node.js  (padrão: 24)
#   PNPM_VERSION=9.15.9    Versão do pnpm           (padrão: 9.15.9)
#   APP_PORT=3001          Porta da API             (padrão: 3001)
#
# Pré-requisitos:
#   - Ubuntu 22.04+ ou Debian 12+
#   - Executar com sudo a partir do diretório do repositório
#   - Acesso à internet para download de pacotes
#
# Após a instalação:
#   1. cp .env.example .env  →  preencha as credenciais
#   2. ./scripts/setup-db.sh  →  aplica as migrações
#   3. sudo systemctl start pwsats-api  →  inicia o servidor
# =============================================================================

set -euo pipefail

# --- Configurações -----------------------------------------------------------

NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"
APP_PORT="${APP_PORT:-3001}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SERVICE_NAME="pwsats-api"
NGINX_SITE="pwsats"

FRONTEND_DIST="${REPO_ROOT}/artifacts/predictions-with-sats-web/dist/public"
API_DIST="${REPO_ROOT}/artifacts/api-server/dist/index.mjs"

# --- Detectar usuário real (quem chamou sudo) --------------------------------

if [[ -n "${SUDO_USER:-}" ]]; then
  APP_USER="$SUDO_USER"
elif [[ "$(id -u)" -ne 0 ]]; then
  APP_USER="$(id -un)"
else
  printf 'Erro: execute com sudo (ex: sudo ./scripts/install-production.sh)\n' >&2
  printf 'Ou defina APP_USER manualmente: APP_USER=ubuntu sudo ./scripts/install-production.sh\n' >&2
  exit 1
fi

APP_USER_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

# --- Helpers -----------------------------------------------------------------

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; }
info() { printf '    %s\n' "$*"; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "Este script precisa ser executado com sudo."
    exit 1
  fi
}

run_as_user() {
  local cmd="$1"
  su "$APP_USER" -s /bin/bash -c \
    "export HOME='${APP_USER_HOME}'; export PATH=/usr/local/bin:/usr/bin:/bin:\$PATH; cd '${REPO_ROOT}' && ${cmd}"
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

# --- Pacotes do sistema ------------------------------------------------------

install_apt_packages() {
  log "Instalando dependências do sistema"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    lsb-release \
    nginx \
    openssl \
    pkg-config \
    postgresql \
    postgresql-client \
    postgresql-contrib \
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
  log "Configurando pnpm ${PNPM_VERSION} via corepack"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  ok "pnpm $(pnpm --version 2>/dev/null || echo 'instalado') disponível."
}

# --- Dependências do workspace -----------------------------------------------

install_dependencies() {
  log "Instalando dependências do workspace (pnpm install)"
  run_as_user "pnpm install --frozen-lockfile"
  ok "Dependências instaladas."
}

# --- Build -------------------------------------------------------------------

build_project() {
  log "Compilando o projeto"

  info "Compilando libs compartilhadas..."
  run_as_user "pnpm --filter @workspace/api-zod run build 2>/dev/null || true"
  run_as_user "pnpm --filter @workspace/api-client-react run build 2>/dev/null || true"

  info "Compilando API (esbuild)..."
  run_as_user "pnpm --filter @workspace/api-server run build"

  info "Compilando frontend (vite)..."
  run_as_user "NODE_ENV=production pnpm --filter @workspace/predictions-with-sats-web run build"

  ok "Build concluído."
  info "API:      ${API_DIST}"
  info "Frontend: ${FRONTEND_DIST}"
}

# --- .env.example ------------------------------------------------------------

create_env_example() {
  local env_example="${REPO_ROOT}/.env.example"

  if [[ -f "${env_example}" ]]; then
    ok ".env.example já existe."
    return
  fi

  log "Criando .env.example"
  cat > "${env_example}" <<'ENVEOF'
# =============================================================================
# Predictions With Sats — Variáveis de Ambiente
# =============================================================================
# Renomeie para .env e preencha todos os campos OBRIGATÓRIOS antes de iniciar.

# --- Servidor ----------------------------------------------------------------
NODE_ENV=production
PORT=3001

# --- Banco de dados ----------------------------------------------------------
# OBRIGATÓRIO — Substitua SENHA_AQUI pela senha configurada no PostgreSQL
DATABASE_URL="postgresql://pwsats:SENHA_AQUI@localhost:5432/pwsats_db"

# --- Lightning / Pagamentos --------------------------------------------------
# OBRIGATÓRIO — Endereço Lightning para recebimento (ex: nome@coinos.io)
LIGHTNING_ADDRESS=

# OBRIGATÓRIO — Token da API Alby para gerenciar webhooks
ALBY_API_TOKEN=

# OBRIGATÓRIO — Segredo HMAC para verificar webhooks Alby
WEBHOOK_SECRET=

# OBRIGATÓRIO — URL pública do endpoint webhook (ex: https://seudominio.com/api/webhook/alby)
WEBHOOK_URL=

# OBRIGATÓRIO — URL base pública da aplicação (ex: https://seudominio.com)
PUBLIC_BASE_URL=

# OBRIGATÓRIO — JWT do Coinos para pagamentos de saída
COINOS_JWT_TOKEN=

# --- Esportes ----------------------------------------------------------------
# OBRIGATÓRIO — Chave da API TheSportsDB
API_FOOTBALL_KEY=

# --- Sessão ------------------------------------------------------------------
# OBRIGATÓRIO — String aleatória para assinar sessões (mínimo 32 caracteres)
SESSION_SECRET=

# --- Configurações avançadas (opcionais) -------------------------------------
# LOG_LEVEL=info
# BASE_PATH=/

# --- Notificações (opcionais) ------------------------------------------------
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
# TUNNEL_NOTIFY_WEBHOOK_URL=
ENVEOF

  chown "${APP_USER}:${APP_USER}" "${env_example}"
  ok ".env.example criado em ${env_example}"
}

# --- PostgreSQL --------------------------------------------------------------

setup_postgresql() {
  log "Configurando PostgreSQL"

  systemctl enable postgresql
  systemctl start postgresql

  # Tentar ler credenciais do .env existente
  local db_user="pwsats"
  local db_pass=""
  local db_name="pwsats_db"

  if [[ -f "${REPO_ROOT}/.env" ]]; then
    local db_url
    db_url="$(grep -E '^DATABASE_URL=' "${REPO_ROOT}/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' || true)"
    if [[ -n "${db_url}" ]]; then
      db_user="$(printf '%s' "${db_url}" | sed -E 's|postgresql://([^:]+):.*|\1|')"
      db_pass="$(printf '%s' "${db_url}" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')"
      db_name="$(printf '%s' "${db_url}" | sed -E 's|.*/([^?]+).*|\1|')"
    fi
  fi

  # Gerar senha aleatória se não tiver uma
  if [[ -z "${db_pass}" ]]; then
    db_pass="$(openssl rand -hex 16)"
    GENERATED_DB_PASS="${db_pass}"
    GENERATED_DB_USER="${db_user}"
    GENERATED_DB_NAME="${db_name}"
  else
    GENERATED_DB_PASS=""
    GENERATED_DB_USER=""
    GENERATED_DB_NAME=""
  fi

  # Criar role se não existir
  su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${db_user}'\" 2>/dev/null | grep -q 1 || \
    psql -c \"CREATE ROLE \\\"${db_user}\\\" WITH LOGIN PASSWORD '${db_pass}'\"" 2>/dev/null || \
    su -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${db_user}'\" | grep -q 1 || \
    psql -c \"CREATE ROLE \\\"${db_user}\\\" WITH LOGIN PASSWORD '${db_pass}'\"" postgres

  # Criar banco se não existir
  su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\" 2>/dev/null | grep -q 1 || \
    psql -c \"CREATE DATABASE \\\"${db_name}\\\" OWNER \\\"${db_user}\\\"\"" 2>/dev/null || \
    su -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\" | grep -q 1 || \
    psql -c \"CREATE DATABASE \\\"${db_name}\\\" OWNER \\\"${db_user}\\\"\"" postgres

  ok "PostgreSQL: banco '${db_name}', usuário '${db_user}'."

  if [[ -n "${GENERATED_DB_PASS:-}" ]]; then
    printf '\n'
    printf '  \033[1;33m[ATENÇÃO]\033[0m Credenciais geradas para o banco de dados:\n'
    printf '  DATABASE_URL="postgresql://%s:%s@localhost:5432/%s"\n' \
      "${GENERATED_DB_USER}" "${GENERATED_DB_PASS}" "${GENERATED_DB_NAME}"
    printf '  Adicione a linha acima ao arquivo .env\n\n'
  fi
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
        # Necessário para webhooks Lightning (sem buffer de resposta)
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
User=${APP_USER}
WorkingDirectory=${REPO_ROOT}/artifacts/api-server

# Carrega o .env e inicia o servidor
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

  ok "Serviço '${SERVICE_NAME}' instalado e habilitado (não iniciado — configure o .env primeiro)."
}

# --- Script de migração do banco ---------------------------------------------

create_setup_db_script() {
  local setup_db="${REPO_ROOT}/scripts/setup-db.sh"

  if [[ -f "${setup_db}" ]]; then
    ok "scripts/setup-db.sh já existe."
    return
  fi

  log "Criando scripts/setup-db.sh"
  cat > "${setup_db}" <<'DBEOF'
#!/usr/bin/env bash
# Aplica as migrações do banco de dados.
# Execute uma única vez, após configurar o .env.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  printf 'Erro: %s/.env não encontrado.\n' "${REPO_ROOT}" >&2
  printf 'Configure o .env antes de executar este script.\n' >&2
  exit 1
fi

printf 'Aplicando migrações...\n'
cd "${REPO_ROOT}"
pnpm --filter @workspace/db run push
printf 'Migrações concluídas.\n'
DBEOF

  chmod +x "${setup_db}"
  chown "${APP_USER}:${APP_USER}" "${setup_db}"
  ok "scripts/setup-db.sh criado."
}

# --- Permissões do diretório -------------------------------------------------

fix_permissions() {
  log "Ajustando permissões do diretório"
  chown -R "${APP_USER}:${APP_USER}" "${REPO_ROOT}"
  ok "Permissões ajustadas para ${APP_USER}."
}

# --- Resumo final ------------------------------------------------------------

print_summary() {
  local node_version pnpm_version
  node_version="$(node --version 2>/dev/null || echo 'n/a')"
  pnpm_version="$(su "$APP_USER" -s /bin/bash -c 'export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; pnpm --version 2>/dev/null || echo n/a')"

  cat <<SUMMARY

╔══════════════════════════════════════════════════════════════════╗
║        Predictions With Sats — Instalação Concluída            ║
╚══════════════════════════════════════════════════════════════════╝

  Node.js:  ${node_version}
  pnpm:     ${pnpm_version}
  Usuário:  ${APP_USER}
  Repo:     ${REPO_ROOT}
  Serviço:  ${SERVICE_NAME}

──────────────────────────────────────────────────────────────────
  PRÓXIMOS PASSOS:
──────────────────────────────────────────────────────────────────

  1. Configure as credenciais:

       cp ${REPO_ROOT}/.env.example ${REPO_ROOT}/.env
       nano ${REPO_ROOT}/.env

     Campos obrigatórios: DATABASE_URL, LIGHTNING_ADDRESS,
     ALBY_API_TOKEN, WEBHOOK_SECRET, WEBHOOK_URL, PUBLIC_BASE_URL,
     COINOS_JWT_TOKEN, API_FOOTBALL_KEY, SESSION_SECRET

  2. Aplique as migrações do banco (execute como ${APP_USER}):

       ${REPO_ROOT}/scripts/setup-db.sh

  3. Inicie o servidor:

       sudo systemctl start ${SERVICE_NAME}

──────────────────────────────────────────────────────────────────
  COMANDOS ÚTEIS:
──────────────────────────────────────────────────────────────────

  Status:     sudo systemctl status ${SERVICE_NAME}
  Logs:       sudo journalctl -u ${SERVICE_NAME} -f
  Parar:      sudo systemctl stop ${SERVICE_NAME}
  Reiniciar:  sudo systemctl restart ${SERVICE_NAME}
  Rebuild:    sudo -u ${APP_USER} ${REPO_ROOT}/scripts/build-deploy.sh

  Aplicação:  http://localhost       (frontend via nginx)
  API health: http://localhost/api/healthz

──────────────────────────────────────────────────────────────────
SUMMARY
}

# --- Entrypoint --------------------------------------------------------------

require_root
check_os
install_apt_packages
install_nodejs
install_pnpm
install_dependencies
build_project
create_env_example
setup_postgresql
setup_nginx
setup_systemd
create_setup_db_script
fix_permissions
print_summary
