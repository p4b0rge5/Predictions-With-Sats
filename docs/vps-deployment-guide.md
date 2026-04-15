# Guia de Deploy — Predictions With Sats (VPS Produção)

## Recomendação de Hardware

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| vCPU | 1 core | 2 cores |
| RAM | 1 GB | 2 GB |
| Disco (SSD) | 20 GB | 40 GB |
| Transferência | 1 TB/mês | 2 TB/mês |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

> A aplicação é leve — o consumo principal é do PostgreSQL e do polling de APIs esportivas. 2 GB RAM garante folga para crescimento.

---

## Visão Geral da Arquitetura

```
Internet
   │
   ▼
[Nginx :443]  ← SSL via Certbot (Let's Encrypt)
   ├── /api/*  → proxy → Express API  :3001
   └── /*      → arquivos estáticos do React (dist/public)

[Express API :3001]  ← PM2 (processo em background)
   └── [PostgreSQL :5432]  ← banco local
```

---

## Parte 1 — Preparar o Servidor

### 1.1 Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Instalar dependências base

```bash
sudo apt install -y git curl wget nginx certbot python3-certbot-nginx ufw
```

### 1.3 Configurar firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## Parte 2 — Instalar Node.js 22 e pnpm

### 2.1 Instalar Node.js via NodeSource (LTS 22)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # deve mostrar v22.x.x
```

### 2.2 Instalar pnpm

```bash
npm install -g pnpm
pnpm -v   # deve mostrar 9.x ou superior
```

### 2.3 Instalar PM2 (gerenciador de processos)

```bash
npm install -g pm2
pm2 -v
```

---

## Parte 3 — Instalar PostgreSQL

### 3.1 Instalar

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 3.2 Criar banco e usuário

```bash
sudo -u postgres psql
```

Dentro do psql:

```sql
CREATE USER pwsats WITH PASSWORD 'ESCOLHA_UMA_SENHA_FORTE';
CREATE DATABASE pwsats_db OWNER pwsats;
GRANT ALL PRIVILEGES ON DATABASE pwsats_db TO pwsats;
\q
```

### 3.3 Anotar a DATABASE_URL

```
postgresql://pwsats:ESCOLHA_UMA_SENHA_FORTE@localhost:5432/pwsats_db
```

---

## Parte 4 — Clonar o Repositório

### 4.1 Conectar o Replit ao GitHub (feito uma vez pelo desktop)

No Replit pelo navegador desktop:
1. Painel lateral → **Version Control** → **Connect to GitHub**
2. Crie ou selecione um repositório privado
3. Faça **Push** do código

### 4.2 Clonar na VPS

```bash
# Substitua pela URL do seu repositório
git clone https://github.com/SEU_USUARIO/SEU_REPO.git /home/pwsats/app
cd /home/pwsats/app
```

> Dica: crie um usuário dedicado na VPS para a aplicação:
> ```bash
> sudo adduser --disabled-password --gecos "" pwsats
> sudo su - pwsats
> ```

---

## Parte 5 — Variáveis de Ambiente

Crie o arquivo de variáveis da API:

```bash
nano /home/pwsats/app/.env
```

Conteúdo do `.env`:

```env
# Banco de dados
DATABASE_URL=postgresql://pwsats:ESCOLHA_UMA_SENHA_FORTE@localhost:5432/pwsats_db

# Lightning / Alby
ALBY_API_TOKEN=seu_token_alby
LIGHTNING_ADDRESS=p4b0rge55@coinos.io
WEBHOOK_SECRET=seu_webhook_secret

# URL pública do webhook (substitua pelo seu domínio)
WEBHOOK_URL=https://pwsats.com/api/webhook/alby

# CoinOS
COINOS_USERNAME=seu_usuario_coinos
COINOS_PASSWORD=sua_senha_coinos
COINOS_JWT_TOKEN=seu_jwt_coinos

# API Football (esportes)
API_FOOTBALL_KEY=sua_chave_api_football

# Servidor
PORT=3001
NODE_ENV=production
```

> **Nunca** suba o `.env` para o git. Confirme que `.env` está no `.gitignore`.

---

## Parte 6 — Instalar Dependências e Build

```bash
cd /home/pwsats/app

# Instalar todas as dependências do monorepo
pnpm install --frozen-lockfile
```

### 6.1 Migrar o banco de dados

```bash
# Aplica o schema Drizzle no PostgreSQL
DATABASE_URL=postgresql://pwsats:ESCOLHA_UMA_SENHA_FORTE@localhost:5432/pwsats_db \
  pnpm --filter @workspace/db run push
```

### 6.2 Build da API (Express)

```bash
pnpm --filter @workspace/api-server run build
# Output: artifacts/api-server/dist/index.mjs
```

### 6.3 Build do Frontend (React)

```bash
PORT=3001 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/predictions-with-sats-web run build
# Output: artifacts/predictions-with-sats-web/dist/public/
```

---

## Parte 7 — Iniciar a API com PM2

Crie o arquivo de configuração do PM2:

```bash
nano /home/pwsats/app/ecosystem.config.cjs
```

```js
module.exports = {
  apps: [
    {
      name: "pwsats-api",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/home/pwsats/app",
      env_file: "/home/pwsats/app/.env",
      interpreter: "node",
      node_args: "--enable-source-maps",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
```

Inicie e configure para reiniciar no boot:

```bash
cd /home/pwsats/app
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # copie e execute o comando que ele mostrar
```

Verificar se está rodando:

```bash
pm2 status
pm2 logs pwsats-api --lines 50
```

---

## Parte 8 — Configurar Nginx

```bash
sudo nano /etc/nginx/sites-available/pwsats
```

```nginx
server {
    listen 80;
    server_name pwsats.com www.pwsats.com;

    # Frontend (arquivos estáticos React)
    root /home/pwsats/app/artifacts/predictions-with-sats-web/dist/public;
    index index.html;

    # React Router — redireciona tudo para index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API — proxy para Express
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

Ativar o site:

```bash
sudo ln -s /etc/nginx/sites-available/pwsats /etc/nginx/sites-enabled/
sudo nginx -t          # verifica se a config está correta
sudo systemctl reload nginx
```

---

## Parte 9 — SSL com Let's Encrypt

```bash
sudo certbot --nginx -d pwsats.com -d www.pwsats.com
```

O Certbot atualiza o Nginx automaticamente com HTTPS. Verifique a renovação automática:

```bash
sudo certbot renew --dry-run
```

---

## Parte 10 — Apontar o DNS

No painel do seu provedor de domínio, configure:

| Tipo | Nome | Valor |
|------|------|-------|
| A | @ | IP_DA_SUA_VPS |
| A | www | IP_DA_SUA_VPS |

---

## Parte 11 — Verificação Final

```bash
# API respondendo
curl https://pwsats.com/api/health

# Logs da aplicação
pm2 logs pwsats-api --lines 100

# Status dos processos
pm2 status

# Nginx OK
sudo systemctl status nginx
```

---

## Atualizações Futuras

Quando quiser fazer deploy de uma nova versão:

```bash
cd /home/pwsats/app

# 1. Puxar as mudanças do GitHub
git pull origin main

# 2. Instalar novas dependências (se houver)
pnpm install --frozen-lockfile

# 3. Rodar migrations (se o schema mudou)
DATABASE_URL=postgresql://pwsats:SENHA@localhost:5432/pwsats_db \
  pnpm --filter @workspace/db run push

# 4. Rebuildar
pnpm --filter @workspace/api-server run build
PORT=3001 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/predictions-with-sats-web run build

# 5. Reiniciar API
pm2 restart pwsats-api
```

---

## Resumo das Portas

| Serviço | Porta | Acesso |
|---------|-------|--------|
| Nginx (HTTP) | 80 | público (redireciona para HTTPS) |
| Nginx (HTTPS) | 443 | público |
| Express API | 3001 | interno (só via Nginx) |
| PostgreSQL | 5432 | interno (só localhost) |
