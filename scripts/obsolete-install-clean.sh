#!/usr/bin/env bash
# =============================================================================
# Predictions With Sats — Instalação Limpa (sem intervenção)
# =============================================================================
# Uso:
#    bash scripts/install-clean.sh
#
# Pré-requisitos:
#    - Ubuntu 22.04+ ou Debian 12+
#    - Executar como root (ou via sudo)
#    - O arquivo .env já configurado na raiz do repositório
#    - Acesso à internet para download de pacotes
#
# O script faz:
#    1.  Instala pacotes do sistema (Node.js 24, pnpm, PostgreSQL, nginx, Tor)
#    2.  Configura Git para usar rede Tor (Anonimato)
#    3.  Instala dependências do workspace (pnpm install)
#    4.  Compila a API e o frontend
#    5.  Cria o usuário/banco PostgreSQL a partir do DATABASE_URL no .env
#    6.  Aplica as migrações do banco (drizzle push)
#    7.  Configura nginx HTTP provisório (para desafio ACME)
#    8.  Emite certificado SSL via Certbot
#    9.  Aplica configuração nginx definitiva (HTTPS dual-stack IPv4+IPv6)
#    10. Registra domínios no Aleph Cloud via SDK (habilita acesso IPv4)
#    11. Corrige permissão do /root para o nginx (www-data) acessar os arquivos
#    12. Cria e inicia o serviço systemd pwsats-api
#
# Variáveis obrigatórias no .env:
#    DATABASE_URL          — conexão PostgreSQL
#    ALEPH_PK              — chave privada Ethereum (hex, sem 0x) da carteira Aleph
#    ALEPH_VM_HASH         — item_hash da instância Aleph desta VM
# =============================================================================

set -euo pipefail

# --- Constantes --------------------------------------------------------------

NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-9.15.9}"
APP_PORT="${APP_PORT:-3001}"
SERVICE_NAME="pwsats-api"
NGINX_SITE="pwsats"
DOMAIN_PRIMARY="${DOMAIN_PRIMARY:-pwsats.com}"
DOMAIN_WWW="${DOMAIN_WWW:-www.pwsats.com}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FRONTEND_DIST="${REPO_ROOT}/artifacts/predictions-with-sats-web/dist/public"
API_DIST="${REPO_ROOT}/artifacts/api-server/dist/index.mjs"

# Detecta o IPv6 público da VM automaticamente (muda a cada nova instância Aleph)
IPV6_ADDR="$(ip -6 addr show scope global 2>/dev/null \
  | grep -oP '(?<=inet6 )[0-9a-f:]+(?=/)' \
  | grep -v '^::1' \
  | head -1 || true)"

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
    python3 python3-venv tor \
    certbot python3-certbot-nginx

  systemctl enable tor
  systemctl start tor
  ok "Pacotes do sistema instalados e serviço Tor iniciado."
}

# --- Configuração Git via Tor ------------------------------------------------

setup_git_tor_proxy() {
  log "Configurando anonimato para Git (Proxy via Tor)"
  # Aguarda o Tor subir para evitar erros de conexão inicial
  sleep 2
  
  # Configura o proxy global para usar SOCKS5h (h força DNS remoto via Tor)
  git config --global http.proxy 'socks5h://127.0.0.1:9050'
  
  info "Verificando conectividade anônima com GitHub..."
  if curl --socks5-hostname 127.0.0.1:9050 -s https://github.com > /dev/null; then
    ok "Conectividade Git-over-Tor confirmada."
  else
    info "Aviso: Tor configurado, mas o teste de conexão falhou (pode ser latência)."
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
  log "Configurando nginx (HTTP provisório para emissão do certificado)"

  # Oculta versão do nginx nos headers HTTP (anonimato)
  sed -i 's|^\s*#\s*server_tokens off;|	server_tokens off;|' /etc/nginx/nginx.conf

  local nginx_conf="/etc/nginx/sites-available/${NGINX_SITE}"

  # Config temporária HTTP-only: necessária para o desafio ACME do Certbot.
  # A função setup_nginx_final() sobrescreve isso com a config HTTPS definitiva
  # após a emissão do certificado.
  cat > "${nginx_conf}" <<NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_PRIMARY} ${DOMAIN_WWW};

    root ${FRONTEND_DIST};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

  ln -sf "${nginx_conf}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
  rm -f /etc/nginx/sites-enabled/default

  nginx -t
  systemctl enable nginx
  systemctl reload nginx 2>/dev/null || systemctl start nginx

  ok "nginx HTTP provisório ativo (porta 80)."
}

# --- Nginx final (HTTPS + dual-stack) ----------------------------------------

setup_nginx_final() {
  log "Aplicando configuração nginx definitiva (IPv4 + IPv6 + HTTPS)"

  # Pré-requisito: certificado já emitido pelo Certbot
  local cert="/etc/letsencrypt/live/${DOMAIN_PRIMARY}/fullchain.pem"
  if [[ ! -f "${cert}" ]]; then
    err "Certificado não encontrado em ${cert}. Execute setup_certbot primeiro."
    exit 1
  fi

  local nginx_conf="/etc/nginx/sites-available/${NGINX_SITE}"

  # Arquitetura Aleph.im:
  #   - IPv6 chega diretamente na porta 443 da VM (HAProxy do CRN roteia por SNI).
  #   - IPv4 passa pelo HAProxy do CRN via roteamento de domínio (registrado via SDK Aleph).
  #   - Ambos os protocolos são atendidos pelos blocos listen abaixo sem configuração extra.
  #
  # Registros DNS necessários no provedor:
  #   A    @   → IPv4 público do CRN Aleph (descubra com: curl -4 -s https://ipinfo.io/ip)
  #   A    www → mesmo IPv4
  #   AAAA @   → ${IPV6_ADDR:-<detectado automaticamente>}
  #   AAAA www → ${IPV6_ADDR:-<detectado automaticamente>}
  #
  # Nota OCSP: certificados emitidos pela cadeia Let's Encrypt E8 não incluem
  # URL de OCSP Stapling; ssl_stapling é desabilitado para evitar avisos no log.

  cat > "${nginx_conf}" <<NGINXEOF
# =============================================================================
# Predictions With Sats — nginx reverse proxy
# Suporte dual-stack: IPv4 (NAT Aleph) + IPv6 (direto)
# =============================================================================

# --- HTTP → HTTPS redirect (IPv4 + IPv6) ------------------------------------
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_PRIMARY} ${DOMAIN_WWW};
    return 301 https://\$host\$request_uri;
}

# --- HTTPS (IPv4 + IPv6) -----------------------------------------------------
server {
    listen 443 ssl;
    listen [::]:443 ssl ipv6only=on;
    server_name ${DOMAIN_PRIMARY} ${DOMAIN_WWW};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN_PRIMARY}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_PRIMARY}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Certificados Let's Encrypt E8 não incluem URL OCSP
    ssl_stapling off;

    root ${FRONTEND_DIST};
    index index.html;

    proxy_read_timeout    60s;
    proxy_connect_timeout 10s;
    proxy_send_timeout    60s;

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

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
}
NGINXEOF

  nginx -t
  systemctl reload nginx
  ok "nginx definitivo ativo (porta 80 redirect + porta 443 HTTPS dual-stack)."
}

# --- Certbot (Let's Encrypt) -------------------------------------------------

setup_certbot() {
  log "Emitindo certificado SSL (Let's Encrypt)"

  info "Domínios: ${DOMAIN_PRIMARY}, ${DOMAIN_WWW}"

  # --certonly: apenas emite o certificado; NÃO modifica o nginx.
  # A config nginx definitiva com HTTPS é aplicada por setup_nginx_final().
  # --nginx: usa o plugin nginx para o desafio ACME (porta 80 deve estar ativa).
  certbot certonly \
    --nginx \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    -d "${DOMAIN_PRIMARY}" \
    -d "${DOMAIN_WWW}"

  systemctl enable certbot.timer
  systemctl start  certbot.timer
  ok "Timer de renovação automática (certbot.timer) habilitado."

  info "Testando renovação automática (dry-run)..."
  if certbot renew --dry-run --quiet; then
    ok "Dry-run de renovação: OK."
  else
    info "Aviso: dry-run falhou — verifique conectividade DNS e portas 80/443 abertas."
  fi

  ok "Certificado emitido para ${DOMAIN_PRIMARY} e ${DOMAIN_WWW}."
}

# --- Aleph Cloud: registro de domínio IPv4 -----------------------------------

setup_aleph_ipv4() {
  log "Registrando domínios no Aleph Cloud (habilita acesso IPv4)"

  # Lê credenciais do .env
  local aleph_pk aleph_vm_hash
  aleph_pk="$(grep -E '^ALEPH_PK=' "${REPO_ROOT}/.env" | head -1 | cut -d'=' -f2- | tr -d '"' || true)"
  aleph_vm_hash="$(grep -E '^ALEPH_VM_HASH=' "${REPO_ROOT}/.env" | head -1 | cut -d'=' -f2- | tr -d '"' || true)"

  if [[ -z "${aleph_pk}" || -z "${aleph_vm_hash}" ]]; then
    info "ALEPH_PK ou ALEPH_VM_HASH ausentes no .env — pulando registro Aleph."
    info "Para habilitar IPv4 em uma próxima instalação, adicione ao .env:"
    info "  ALEPH_PK=<chave_privada_ethereum_hex_sem_0x>"
    info "  ALEPH_VM_HASH=<item_hash_da_instancia_aleph>"
    return
  fi

  # Garante o venv Python para o SDK Aleph
  local venv_dir="/opt/aleph-venv"
  if [[ ! -d "${venv_dir}" ]]; then
    python3 -m venv "${venv_dir}"
  fi
  if ! "${venv_dir}/bin/pip" show aleph-sdk-python &>/dev/null 2>&1; then
    info "Instalando aleph-sdk-python..."
    "${venv_dir}/bin/pip" install -q aleph-sdk-python
  fi

  info "Publicando Aggregates (port-forwarding + domains)..."
  PK="${aleph_pk}" \
  VM_HASH="${aleph_vm_hash}" \
  DOMAIN_PRIMARY="${DOMAIN_PRIMARY}" \
  DOMAIN_WWW="${DOMAIN_WWW}" \
    "${venv_dir}/bin/python3" "${SCRIPT_DIR}/aleph-register-domain.py"

  ok "Domínios ${DOMAIN_PRIMARY} e ${DOMAIN_WWW} registrados no Aleph Cloud."
  info "O HAProxy do CRN leva ~2 min para atualizar o roteamento."
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
After=network.target postgresql.service tor.service
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
  local ipv4_crn
  ipv4_crn="$(curl -4 -s --max-time 5 https://ipinfo.io/ip 2>/dev/null || echo '<indisponível>')"

  cat <<SUMMARY

╔══════════════════════════════════════════════════════════════════╗
║      Predictions With Sats — Instalação Concluída (Anon)        ║
╚══════════════════════════════════════════════════════════════════╝

  Node.js:   $(node --version)
  pnpm:      $(pnpm --version)
  Git Proxy: socks5h://127.0.0.1:9050 (Via Tor)
  Serviço:   ${SERVICE_NAME}
  Repo:      ${REPO_ROOT}

──────────────────────────────────────────────────────────────────
  REDE (Aleph Cloud):
──────────────────────────────────────────────────────────────────
  IPv6 da VM:  ${IPV6_ADDR:-<não detectado>}
  IPv4 do CRN: ${ipv4_crn}

  Registros DNS necessários na Njalla:
    AAAA  @    →  ${IPV6_ADDR:-<ipv6 da VM>}
    AAAA  www  →  ${IPV6_ADDR:-<ipv6 da VM>}
    A     @    →  ${ipv4_crn}
    A     www  →  ${ipv4_crn}

──────────────────────────────────────────────────────────────────
  APLICAÇÃO (HTTPS):
──────────────────────────────────────────────────────────────────
  Frontend:  https://${DOMAIN_PRIMARY}
  Frontend:  https://${DOMAIN_WWW}
  API:       https://${DOMAIN_PRIMARY}/api/healthz

──────────────────────────────────────────────────────────────────
  SSL / RENOVAÇÃO:
──────────────────────────────────────────────────────────────────
  Certificados: /etc/letsencrypt/live/${DOMAIN_PRIMARY}/
  Renovação:    systemctl status certbot.timer
  Forçar renov: certbot renew --force-renewal

──────────────────────────────────────────────────────────────────
  COMANDOS ÚTEIS:
──────────────────────────────────────────────────────────────────
  Status:      systemctl status ${SERVICE_NAME}
  Logs:        journalctl -u ${SERVICE_NAME} -f
  Parar:       systemctl stop ${SERVICE_NAME}
  Reiniciar:   systemctl restart ${SERVICE_NAME}
  Rebuild:     bash ${REPO_ROOT}/scripts/build-deploy.sh

──────────────────────────────────────────────────────────────────
SUMMARY
}

# --- Entrypoint --------------------------------------------------------------

require_root
require_env_file
check_os
install_apt_packages
setup_git_tor_proxy
install_nodejs
install_pnpm
install_dependencies
build_project
setup_postgresql
run_migrations
fix_root_permissions
setup_nginx
setup_certbot
setup_nginx_final
setup_aleph_ipv4
setup_systemd
start_service
smoke_test
print_summary
