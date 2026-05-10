# Predictions-With-Sats — Guia de Onboarding para o Próximo Agente

> **Criado em:** 2026-05-10 por `pwsatsdevbot`
> **Propósito:** Este documento contém **tudo** que o agente anterior construiu e aprendeu. Leia integralmente antes de começar qualquer trabalho.

---

## 1. Visão Geral do Projeto

**Predictions-With-Sats** (pwsats.com) é uma plataforma de apostas descentralizada via Lightning Network. Os usuários pagam sats (mínimo 1 sat) para prever resultados de:

1. **Preço de cripto** — BTC, ETH, SOL sobem ou descem em janelas de 5 minutos
2. **Esportes** — Futebol, NBA, NFL, MLB, MMA, Rugby, Hockey, Basquete (resultados de 3 vias: home/draw/away)
3. **Clima** — Temperatura sim/não para cidades específicas

### Fluxo de Aposta (end-to-end)

```
Usuário escolhe mercado → Frontend gera invoice Lightning (Alby LNURL)
  → Usuário paga com carteira Lightning
    → Poller confirma pagamento (LUD-21 → fallback Alby API)
      → Market engine assenta resultado quando janela/evento termina
        → Vencedores recebem via Coinos.io (LNURL-Withdraw)
```

### House Fee
- **Normal:** 2% do pool (quando 2+ resultados têm liquidez)
- **Refund:** 0.5% (quando apenas 1 resultado tem apostas — sem liquidez oposta)

### Links
- **Produção:** https://pwsats.com
- **GitHub:** https://github.com/p4borge55/Predictions-With-Sats
- **Dev Machine (este servidor):** https://priority-swing-fork-monkey.2n6.me/app
- **API Docs (auto-generadas):** https://pwsats.com/api/docs

---

## 2. Infraestrutura

### Máquinas

| Ambiente | Provedor | OS | PostgreSQL | Node | pnpm |
|----------|----------|-----|------------|------|------|
| **Dev (este VM)** | Aleph Cloud | Ubuntu 24.04 | 16 | 20 | 10 |
| **Produção** | Aleph Cloud | Debian 12 | 15 | 20 | 10.33.4 |

### Servidor de Dev (este VM)
- **Full root access** — sua máquina. Instale o que precisar.
- **FQDN:** `priority-swing-fork-monkey.2n6.me`
- **Serviços:**
  - `pwsats-api` → port 3001 (API backend)
  - `pwsats-web` → port 3002 (frontend Vite preview)
  - `caddy` → ports 80/443 (reverse proxy + HTTPS)
  - `baal-agent` → port 8080 (agente AI, via `.2n6.me`)
- **Caddy serve 2 domains:** `pwsats.com` + `.2n6.me`
- **BASE_PATH=/app** no dev — o frontend é servido em `/app`

### Servidor de Produção
- **IP:** `37.114.37.140`
- **SSH:** port `24003`
- **SSH key:** `/root/.ssh/id_ed25519_deployment`
- **IPv6:** `2a0e:97c0:3e3:274:3:d6e:5c17:e5a1`
- **DNS:** Njalla — A record + AAAA record para `pwsats.com`
- **Certificado:** Let's Encrypt automático (HTTP-01), obtido 2026-05-09, expira 2026-08-07
- **Caddy serve APENAS `pwsats.com`** — não há agente AI na produção
- **BASE_PATH=/** na produção — frontend serve na raiz do domínio
- **Caddy serve static files directly** (o `pwsats-web` systemd é backup)

### Caddy Routing (dev — 2 site blocks)

```
pwsats.com block:
  /          → rewrite to /app → reverse_proxy :3002 (Vite)
  /app/api/* → strip /app → reverse_proxy :3001 (API)
  /api/*     → reverse_proxy :3001 (API, direto)
  /app/*     → reverse_proxy :3002 (Vite)

priority-swing-fork-monkey.2n6.me block:
  /*         → reverse_proxy :8080 (baal-agent)
```

⚠️ **Nunca edite `/etc/caddy/Caddyfile` diretamente** — o deploy overwrites ele. Use `/etc/caddy/conf.d/*.caddy` para snippets personalizados.

---

## 3. Banco de Dados

### Detalhes
- **Database:** `pwsats_db`
- **App user:** `pwsats` (password: `p4borge55`) — usado pelo app em `.env`
- **Owner user:** `p4borge55` (mesma senha) — usado para dumps e GRANT

### 10 Tabelas Drizzle ORM

| Arquivo | Tabela | Descrição |
|---------|--------|-----------|
| `bets.ts` | `bets` | Apostas de preço (cripto) |
| `market-windows.ts` | `market_windows` | Janelas de 5 min para mercado de preço |
| `price-snapshots.ts` | `price_snapshots` | Preços históricos BTC/ETH/SOL |
| `sport-bets.ts` | `sport_bets` | Apostas de esportes |
| `sport-markets.ts` | `sport_markets` | Mercados esportivos (3 vias: home/draw/away) |
| `sport-poly-bets.ts` | `sport_poly_bets` | Apostas com odds Polymarket |
| `sport-poly-markets.ts` | `sport_poly_markets` | Mercados com odds Polymarket |
| `weather-bets.ts` | `weather_bets` | Apostas de clima |
| `weather-markets.ts` | `weather_markets` | Mercados de temperatura |
| `webhook-events.ts` | `webhook_events` | Idempotência de webhooks de pagamento |

### Esquema de Status de Apostas (price bets)
```
pending → paid → won/lost → (withdraw) → withdrawn
                ↓
           expired (após 1 hora sem pagamento)
```

### Esquema de Status de Mercados (sports)
```
open → finished → settled
```

### Regras Críticas
1. **Depois de importar dump:** rodar `GRANT ALL ON ALL TABLES/SEQUENCES TO pwsats` — o dump cria tabelas como `postgres`
2. **Nunca drop tables em produção** — use apenas `ALTER TABLE ADD COLUMN`
3. **drizzle-kit push** só funciona se `DATABASE_URL` estiver no environment

---

## 4. Arquitetura de Código (Monorepo pnpm)

```
Predictions-With-Sats/
├── artifacts/
│   ├── api-server/              ← Backend (Express + Hono)
│   │   ├── src/
│   │   │   ├── routes/          ← Endpoints REST
│   │   │   │   ├── bet.ts              # Apostas de preço (cripto)
│   │   │   │   ├── market.ts           # Janelas de mercado
│   │   │   │   ├── sports.ts           # Apostas de esportes
│   │   │   │   ├── sports-poly.ts      # Esportes com odds Polymarket
│   │   │   │   ├── weather.ts          # Apostas de clima
│   │   │   │   ├── nostr.ts            # Integração Nostr
│   │   │   │   ├── webhook.ts          # Webhooks Alby (pagamento)
│   │   │   │   ├── withdraw.ts         # Saques via Coinos
│   │   │   │   ├── health.ts           # /api/healthz
│   │   │   │   └── stats.ts            # Estatísticas públicas
│   │   │   └── lib/
│   │   │       ├── alby.ts               # Invoicing Lightning (LNURL-Pay)
│   │   │       ├── payment-poller.ts     # Poll pagamentos (5s, 2 tiers)
│   │   │       ├── market.ts             # Engine mercado preço (5-min windows)
│   │   │       ├── sports-market.ts      # Engine mercados esportivos
│   │   │       ├── sports-pollers.ts     # Poll settlement esportes (15 min)
│   │   │       ├── weather-pollers.ts    # Poll settlement clima
│   │   │       ├── coinos.ts             # Saques via Coinos.io
│   │   │       ├── nostr.ts              # Nostr client
│   │   │       ├── nostr-publisher.ts    # Publicar mercados no Nostr
│   │   │       ├── nostr-digest.ts       # Digest diário no Nostr
│   │   │       ├── lightning-invoice.ts  # Validação BOLT11
│   │   │       ├── lnurl-withdraw.ts     # LNURL-Withdraw helpers
│   │   │       ├── withdraw-k1.ts        # Nonce k1 seguro para saques
│   │   │       ├── price.ts              # Preços cripto (CoinGecko)
│   │   │       ├── sports.ts             # TheSportsDB (futebol)
│   │   │       ├── nba.ts, nfl.ts, etc.  # APIs específicas por esporte
│   │   │       ├── polymarket-*.ts       # Integração Polymarket
│   │   │       ├── config.ts             # Carrega .env (Alby tokens)
│   │   │       ├── logger.ts             # Pino logger
│   │   │       └── card-image.ts         # Gerar imagens de mercado
│   │   └── dist/                 ← Build output
│   ├── predictions-with-sats-web/  ← Frontend (React + Vite)
│   │   ├── src/pages/
│   │   │   ├── home.tsx          # Página principal (preço cripto)
│   │   │   ├── sports.tsx        # Página de esportes
│   │   │   ├── weather.tsx       # Página de clima
│   │   │   └── ...
│   │   ├── src/components/
│   │   │   ├── bet-modal.tsx     # Modal de aposta + QR code
│   │   │   ├── my-bet-widget.tsx # Rastreamento de apostas (localStorage)
│   │   │   └── ...
│   │   └── dist/public/          ← Build output (static SPA)
│   └── mockup-sandbox/           ← UI mockup (dev only, não deploya)
├── lib/
│   └── db/                       ← Drizzle ORM schema
│       ├── src/schema/           ← Definições de tabelas
│       └── drizzle.config.ts     ← Configuração Drizzle
├── scripts/                      ← Scripts de deploy e manutenção
├── hooks/                        ← Git hooks (versionados)
├── memory/                       ← Memória do agente (synced via pre-commit)
├── skills/                       ← Skills reutilizáveis do agente
├── backups/                      ← Backups locais de produção
├── db/                           ← Dump em git (backup redundancy)
└── .env                          ← Configuração de ambiente (gitignored)
```

---

## 5. Rotinas Automatizadas

### 5.1. Backup Automático de Produção (2x ao dia)

**Crontab (root):**
```
0 0,12 * * * cd /opt/baal-agent/workspace/Predictions-With-Sats && source .env.deploy && ./scripts/backup-prod-db.sh >> .runtime/logs/backup-prod-db.log 2>&1
```

**O que faz:**
1. SSH para produção (`37.114.37.140:24003`)
2. Executa `pg_dump --clean --if-exists --create --no-owner --no-acl`
3. Gzip → salva em `backups/pwsats-prod-backup-YYYYMMDD-HHMMSS.sql.gz`
4. Copia data-indexada: `backups/pwsats-prod-backup-YYYY-MM-DD.sql.gz`
5. Deleta backups > 30 dias

**Depois de rebuild do agente:** o crontab é perdido! Restaurar com:
```bash
echo '0 0,12 * * * cd /opt/baal-agent/workspace/Predictions-With-Sats && source .env.deploy && ./scripts/backup-prod-db.sh >> .runtime/logs/backup-prod-db.log 2>&1' | crontab -
```

### 5.2. Git Hooks (versionados no repositório)

**pre-commit** (`hooks/pre-commit`):
- Sincroniza `MEMORY.md` e `USER.md` de `/opt/baal-agent/workspace/memory/` para `memory/` no repositório

**post-commit** (`hooks/post-commit`):
1. Faz dump do PostgreSQL local → `db/dump.sql`
2. Copia o backup de produção mais recente → `db/prod-backup.sql.gz`
3. Amenda o commit se dump/backup mudaram
4. **Force-push** para `origin main`
5. Usa lock file (`/tmp/pwsats-post-commit.lock`) para evitar recursão

**⚠️ CRÍTICO:** Nunca reporte mudanças como "feitas" sem commitar. O hook post-commit faz o push. Você só precisa disparar o commit.

### 5.3. Pollers do Aplicativo (rodando dentro do API server)

| Poller | Intervalo | O que faz |
|--------|-----------|-----------|
| Payment Poller (price) | 5s | Verifica pagamentos Lightning pendentes (LUD-21 → Alby API) |
| Payment Poller (sports) | 5s | Mesma coisa para apostas esportivas |
| Settlement Poller (sports) | 15 min | Verifica mercados abertos com horário passado, busca resultado na API-Football |
| Weather Poller | 5 min | Busca temperatura real via API, assenta mercados de clima |
| Market Windows | 5 min | Assenta janelas de preço de cripto (open → settled) |

### 5.4. Sistema de Budget de Requisições API

- **API-Football (free plan):** 100 req/dia
- Startup pre-warm tem cooldown de 1 hora (guarda `sports-prewarm.json`)
- Poller de settlement usa cache e só faz `forceRefresh` quando o jogo está atrasado
- Esportes não-futebol (NBA, NFL, etc.) usam APIs gratuitas sem limite conhecido

---

## 6. Deploy para Produção

### Script Principal: `scripts/deploy-to-production.sh`

**Executar na dev machine:**
```bash
cd /opt/baal-agent/workspace/Predictions-With-Sats
source .env.deploy && ./scripts/deploy-to-production.sh       # Full deploy
source .env.deploy && ./scripts/deploy-to-production.sh quick  # Skip deps (mais rápido)
```

**O que faz (9 passos):**
1. Pre-flight checks (conexão SSH, .env local)
2. PostgreSQL setup (usuário + database)
3. Git pull + `pnpm install`
4. Copia `.env` para produção (NÃO importa dump!)
5. **Drizzle push** (schema sync) + GRANT
6. Build API + Web (`BASE_PATH=/`)
7. Restart `pwsats-api` + `pwsats-web`
8. Configurar Caddy + HTTPS
9. Verificação final (healthz, Caddy, cert)

### Arquivo `.env.deploy` (gitignored)

Contém as credenciais para conectar à produção:
```bash
PROD_HOST=37.114.37.140
PROD_PORT=24003
PROD_SSH_KEY=/root/.ssh/id_ed25519_deployment
DOMAIN=pwsats.com
DB_USER=pwsats
DB_PASSWORD=p4borge55
DB_NAME=pwsats_db
GITHUB_CLONE_URL="https://p4b0rge5:ghp_Akj...@github.com/p4b0rge5/Predictions-With-Sats.git"
```

### Script de Restore (DANGER)

```bash
source .env.deploy && ./scripts/restore-dump-to-production.sh
```
- **Requer digitar `DESTROY` para confirmar**
- Para API, copia dump, sobrescreve toda a produção
- Apenas para disaster recovery

---

## 7. Regras de Trabalho (NON-NEGOTIABLE)

### 7.1. Git Commit After Every Code Change
```bash
cd /opt/baal-agent/workspace/Predictions-With-Sats && git add -A && git commit -m "descriptive message"
```
- O post-commit hook faz dump DB + amend + force-push
- **Nunca** finalize sem commitar

### 7.2. Nunca edite `/etc/caddy/Caddyfile` diretamente
- O deploy script sobrescreve o Caddyfile a cada deploy
- Use `/etc/caddy/conf.d/*.caddy` para adições persistentes

### 7.3. BASE_PATH
- **Dev:** `BASE_PATH=/app`
- **Produção:** `BASE_PATH=/`
- Errar o BASE_PATH quebra o frontend

### 7.4. Database
- Nunca drop tables em produção
- Para novas colunas: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- `drizzle-kit push` requer `DATABASE_URL` no environment

### 7.5. Caddy handle blocks
- Use `handle` blocks para roteamento — não misture `reverse_proxy` com `try_files` no mesmo block

---

## 8. Lições Aprendidas (Pitfalls)

### 8.1. DNS AAAA
Let's Encrypt tenta IPv6 primeiro. Se o AAAA está desatualizado, o cert falha. Sempre verificar ambos os records no Njalla DNS.

### 8.2. drizzle-kit push sem DATABASE_URL
O `pnpm --filter @workspace/database exec` não source o `.env` do repo. Se `DATABASE_URL` não estiver exportado, o push falha silenciosamente. **Fix aplicado em 2026-05-10:** o deploy script agora exporta `DATABASE_URL` antes do push.

### 8.3. Colunas faltando → 500
Colunas que estão no schema Drizzle mas não no banco real quebram toda a aplicação. O caso `league_logo` em `sport_markets` (2026-05-10) causou 500 em todos os endpoints de esporte.

### 8.4. Caddy stale process
`caddy run` como root deixa stale port 2019 binding. Sempre `pkill -9 caddy` antes de `systemctl start caddy`.

### 8.5. Cert ownership
`caddy run` como root salva certs em `/root/.local/share/caddy/` → systemd (user `caddy`) não consegue ler. Limpar ambos os cert dirs antes de restart.

### 8.6. GRANT after import
Dump cria tabelas como `postgres` → user `pwsats` fica com `permission denied`. Sempre rodar GRANT depois de importar.

### 8.7. Hockey e Basketball ausentes
`SPORT_KEYS` no frontend estava incompleto. Sempre verificar todos os 8 esportes: soccer, basketball, baseball, hockey, nba, nfl, mma, rugby.

### 8.8. Markets são lazy-created
Mercados esportivos são criados apenas quando alguém faz a primeira aposta (`findOrCreateMarket`). Eventos sem mercado têm `marketStatus: null` — isso é esperado, não é bug.

---

## 9. Serviços Systemd

### pwsats-api
```ini
[Unit]
Description=Predictions With Sats API Server
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/baal-agent/workspace/Predictions-With-Sats
ExecStart=/usr/bin/node artifacts/api-server/dist/index.mjs
EnvironmentFile=/opt/baal-agent/workspace/Predictions-With-Sats/.env
Environment=PORT=3001
Restart=on-failure
RestartSec=5
```

### pwsats-web
```ini
[Unit]
Description=Predictions With Sats Web Frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/baal-agent/workspace/Predictions-With-Sats
ExecStart=/usr/bin/node artifacts/predictions-with-sats-web/node_modules/vite/bin/vite.mjs preview --port 3002
Environment=NODE_ENV=production
Environment=PORT=3002
Restart=on-failure
RestartSec=5
```

### pwsats-tunnel (dev only)
SSH tunnel da produção → localhost:8081 para desenvolvimento remoto.

---

## 10. Integrações Externas

### Alby (Lightning)
- **LNURL-Pay:** Gera invoices BOLT11 para receber pagamentos
- **Webhook:** Recebe notificações push de pagamento (HMAC-verificado, idempotente)
- **REST API:** Fallback para verificar pagamento (tier 2 do poller)
- Config em `.env`: `ALBY_API_TOKEN`, `LIGHTNING_ADDRESS`, `WEBHOOK_SECRET`, `WEBHOOK_URL`

### Coinos.io
- **LNURL-Withdraw:** Paga ganhos via withdraw push
- **JWT Token:** Armazenado em `.env` como `COINOS_JWT_TOKEN`
- Token emitido em 2026-04-06, verificar expiração

### TheSportsDB / API-Football
- Fonte principal para dados de futebol
- Free plan: 100 req/dia
- Budget guard: prewarm com cooldown de 1h

### Nostr
- Publicação de mercados criados e assentados
- Digest diário de resultados
- Client e publisher em `lib/nostr.ts`, `lib/nostr-publisher.ts`, `lib/nostr-digest.ts`

---

## 11. Endpoints da API

| Method | Path | Descrição |
|--------|------|-----------|
| GET | `/api/healthz` | Health check |
| GET | `/api/market/current` | Mercado de preço ativo |
| GET | `/api/market/history` | Histórico de mercados de preço |
| POST | `/api/bet` | Fazer aposta de preço |
| GET | `/api/bets/my` | Apostas do usuário (auth via hash) |
| POST | `/api/withdraw` | Sacar ganhos |
| GET | `/api/sports/events` | Eventos esportivos (upcoming/live/finished) |
| GET | `/api/sports/markets` | Mercados abertos |
| POST | `/api/sports/bets` | Aposta esportiva |
| GET | `/api/sports-poly/markets` | Mercados com odds Polymarket |
| POST | `/api/sports-poly/bets` | Aposta com odds Polymarket |
| GET | `/api/weather/markets` | Mercados de clima |
| POST | `/api/weather/bets` | Aposta de clima |
| GET | `/api/stats` | Estatísticas públicas |
| GET | `/api/nostr/feeds` | Feeds Nostr |
| POST | `/api/webhook/alby` | Webhook Alby (push) |
| GET | `/api/docs` | OpenAPI docs (auto-generated) |

---

## 12. Estrutura de Arquivos do Agente

```
/opt/baal-agent/workspace/
├── memory/
│   ├── MEMORY.md          ← Memória de longo prazo (synced ao repo)
│   └── 2026-05-10.md      ← Notas diárias
├── skills/                 ← Skills reutilizáveis
│   ├── deploy-pwsats-production/
│   ├── debug-drizzle-missing-column/
│   └── ... (22 skills total)
├── cron.json              ← Scheduler de tarefas recorrentes
├── HEARTBEAT.md           ← Fallback (se cron.json não existir)
└── Predictions-With-Sats/ ← Repositório principal
```

**Skills disponíveis:** deploy-pwsats-production, deploy-node-app, debug-drizzle-missing-column, debugging, git-auto-push-hook, pwsats-fix-deploy, pwsats-workflow, remote-db-backup-system, caddy-multi-handler-routing, frontend-design, node-dev, python-dev, web-security, prompt-injection-defense, code-review, testing, software-design, e outros.

---

## 13. Checklist de Emergência

### Site está down?
1. `systemctl status pwsats-api` → está rodando?
2. `journalctl -u pwsats-api -n 50 --no-pager` → erros recentes?
3. `systemctl status caddy` → proxy está ativo?
4. `ss -tlnp | grep -E ':3001|:3002|:443'` → portas abertas?
5. `curl -s -o /dev/null -w "%{http_code}" https://pwsats.com/api/healthz` → 200?

### 500 em endpoints?
1. Verificar logs: `journalctl -u pwsats-api -n 30 | grep -i "does not exist\|error\|fail"`
2. Coluna faltando no banco? → `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
3. Restart API: `systemctl restart pwsats-api`

### Backup falhou?
1. Verificar log: `cat .runtime/logs/backup-prod-db.log | tail -20`
2. SSH funcionando? → `ssh -i /root/.ssh/id_ed25519_deployment -p 24003 root@37.114.37.140 true`
3. `.env.deploy` existe e tem credenciais?

### Cert SSL expirando?
1. Verificar: `echo | openssl s_client -connect pwsats.com:443 -servername pwsats.com 2>/dev/null | openssl x509 -noout -enddate`
2. DNS AAAA correto? → verificar Njalla DNS
3. `caddy reload` → tenta renovar cert

---

## 14. Contatos e Links

| Recurso | Link/Info |
|---------|-----------|
| GitHub | https://github.com/p4b0rge55/Predictions-With-Sats |
| Produção | https://pwsats.com |
| Dev Machine | https://priority-swing-fork-monkey.2n6.me/app |
| Alby Dashboard | https://dashboard.getalby.com |
| Coinos Dashboard | https://coinos.io |
| Njalla DNS | https://njal.la |
| Aleph Cloud | https://aleph.cloud |
| API-Football | https://www.api-football.com |

---

## 15. Estado Atual (2026-05-10)

### O que está funcionando
- ✅ API server rodando (port 3001)
- ✅ Frontend servido via Caddy (https://pwsats.com)
- ✅ 11 eventos esportivos em cache (futebol, basketball, baseball, hockey)
- ✅ 1 mercado aberto (Vasco DA Gama vs Atletico Paranaense)
- ✅ Backups automáticos 2x/dia (00:00, 12:00)
- ✅ Git hooks funcionando (commit → dump → push)
- ✅ All endpoints returning 200

### Bugs fixados recentes
- **league_logo missing column** → `ALTER TABLE sport_markets ADD COLUMN IF NOT EXISTS league_logo text`
- **drizzle-kit push sem DATABASE_URL** → deploy script agora exporta var
- **My Bets missing hockey/basketball** → `SPORT_KEYS` atualizado

### Pendências
- ⚠️ JWT Coinos pode expirar (emitido 2026-04-06)
- ⚠️ Let's Encrypt cert expira 2026-08-07 (auto-renew se DNS OK)
- 💡 Considerar auto-creation de mercados (não apenas lazy-create on first bet)
- 💡 Dashboard admin para gerenciar mercados manualmente

---

*Fim do guia. Se algo aqui não fizer mais sentido, é porque o projeto evoluiu — confie no código atual, não neste documento.*
