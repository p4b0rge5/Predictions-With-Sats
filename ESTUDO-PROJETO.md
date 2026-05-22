# Estudo Completo do Projeto: Predictions With Sats

**Data do estudo:** 2026-05-22  
**Repositório:** https://github.com/p4b0rge5/Predictions-With-Sats  
**Produção:** https://pwsats.com

---

## 📋 Resumo Executivo

**Predictions With Sats (PWSats)** é uma plataforma de apostas descentralizada que permite aos usuários apostar com **Bitcoin (sats)** via Lightning Network em três categorias de mercados:

1. **Crypto** - Prever se o preço de BTC, ETH, SOL, XRP, BNB vai subir ou descer em janelas de 5/15/30 minutos
2. **Sports** - Apostar em resultados de esportes reais (Futebol, NBA, NFL, MLB, MMA, Rugby, Hockey) com dados da Polymarket
3. **Weather** - Apostar em previsões de temperatura/clima

**Diferenciais:**
- Sem accounts, sem sign-ups - apostas anônimas via Lightning
- Pagamentos processados via Lightning Network (LNURL-Pay / LNURL-Withdraw)
- House fee de 2% (0.5% em casos de refund por falta de liquidez)
- Integração com Polymarket para odds externas e dados esportivos
- Auto-deploy com PostgreSQL dump versionado no repo

---

## 🏗️ Arquitetura Técnica

### Stack Tecnológico

| Camada | Tecnologia |
|--------|-----------|
| **Linguagem** | TypeScript 5.9 |
| **Package Manager** | pnpm workspaces + catalog |
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, framer-motion |
| **Data Fetching** | TanStack Query (gerado automaticamente via Orval do OpenAPI) |
| **API** | Express 5, Pino logger |
| **Validação** | Zod v4 (schemas gerados do OpenAPI) |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **Payments** | Lightning Network (Alby LNURL-Pay, Coinos.io para payouts) |
| **Scheduling** | node-cron (settlement polling, market windows, price snapshots) |
| **Build** | esbuild (API), Vite (frontend) |

### Estrutura do Monorepo

```
Predictions-With-Sats/
├── artifacts/
│   ├── api-server/              ← Backend Express 5 (porta 3001)
│   │   ├── src/
│   │   │   ├── routes/          ← Endpoints REST
│   │   │   │   ├── bet.ts              # POST /bet - apostas crypto
│   │   │   │   ├── market.ts           # GET /market/current - estado do mercado
│   │   │   │   ├── sports.ts           # Esportes (API interna)
│   │   │   │   ├── sports-poly.ts      # Esportes com odds Polymarket
│   │   │   │   ├── weather.ts          # Mercados de clima
│   │   │   │   ├── withdraw.ts         # LNURL-Withdraw para saques
│   │   │   │   ├── webhook.ts          # Webhook Alby (confirmação pagamento)
│   │   │   │   ├── nostr.ts            # Integração Nostr
│   │   │   │   ├── stats.ts            # Estatísticas públicas
│   │   │   │   └── health.ts           # /healthz - health check
│   │   │   └── lib/                   ← Lógica de negócio
│   │   │       ├── alby.ts               # LNURL-Pay invoices via Alby
│   │   │       ├── payment-poller.ts     # Polling pagamentos (2 tiers)
│   │   │       ├── market.ts             # Engine de janelas crypto (5/15/30min)
│   │   │       ├── sports-poly.ts        # Engine esportes Polymarket
│   │   │       ├── coinos.ts             # Client Coinos para payouts
│   │   │       ├── price.ts              # Fetch preços crypto (CoinGecko/CoinAPI)
│   │   │       ├── polymarket-sports.ts  # Integração Polymarket Gamma API
│   │   │       └── ... (outros pollers)
│   │   └── package.json
│   │
│   ├── predictions-with-sats-web/   ← Frontend React 19 (porta 3002)
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   │   ├── home.tsx         ← Crypto predictions (BTC/ETH/SOL/XRP/BNB)
│   │   │   │   ├── sports-poly.tsx  ← Sports betting com odds Polymarket
│   │   │   │   ├── weather.tsx      ← Weather betting
│   │   │   │   ├── history.tsx      ← Histórico de apostas
│   │   │   │   ├── my-bets.tsx      ← Dashboard global de apostas
│   │   │   │   └── guide.tsx        ← Guia do usuário
│   │   │   └── components/
│   │   │       ├── bet-modal.tsx      ← Modal de aposta (QR code, WebLN)
│   │   │       ├── my-bet-widget.tsx  ← Widget de apostas salvos
│   │   │       └── ui/                ← Componentes shadcn/ui
│   │   └── package.json
│   │
│   └── mockup-sandbox/          ← Ferramenta de prototipagem UI
│
├── lib/
│   ├── db/                        ← Drizzle ORM schema (PostgreSQL)
│   │   └── src/schema/
│   │       ├── market-windows.ts   # Janelas crypto
│   │       ├── bets.ts             # Apostas crypto
│   │       ├── price-snapshots.ts  # Histórico de preços
│   │       ├── sport-markets.ts    # Mercados esportivos
│   │       ├── sport-bets.ts       # Apostas esportivas
│   │       ├── sport-poly-markets.ts # Mercados com odds Polymarket
│   │       ├── sport-poly-bets.ts  # Apostas Polymarket
│   │       ├── weather-markets.ts  # Mercados de clima
│   │       ├── weather-bets.ts     # Apostas de clima
│   │       ├── webhook-events.ts   # Log de webhooks (idempotência)
│   │       └── seed-migrations.ts  # Seeds idempotentes
│   │
│   ├── api-spec/                   # OpenAPI spec + Orval config
│   ├── api-zod/                    # Zod schemas (gerados do OpenAPI)
│   └── api-client-react/           # React Query hooks (gerados do OpenAPI)
│
├── db/
│   └── dump.sql                    ← Dump PostgreSQL versionado (auto-atualizado)
│
├── scripts/
│   ├── deploy-to-production.sh     ← Script de deploy produção
│   ├── start-services.sh           ← Gerenciador de serviços
│   └── ... (outros scripts ops)
│
├── docs/
│   ├── AGENT-ONBOARDING.md         ← Onboarding para novos agentes
│   ├── vps-deployment-guide.md     ← Guia de deploy VPS
│   └── ...
│
├── AGENTS.md                       ← Documento orientador para agentes
├── ARCHITECTURE.md                 ← Arquitetura detalhada
├── README.md                       ← README principal
└── package.json                    # Root pnpm workspace
```

---

## 🗄️ Banco de Dados

### Tabelas (Drizzle ORM)

| Tabela | Propósito |
|--------|-----------|
| `market_windows` | Janelas de mercado crypto (asset, intervalo, open/close prices, outcome) |
| `bets` | Apostas crypto (payment_hash, sats, direção, status, settlement) |
| `price_snapshots` | Snapshots históricos de preços crypto |
| `sport_markets` | Mercados esportivos (eventId, home/away/draw, start time, status) |
| `sport_bets` | Apostas esportivas (linked ao market, direção, sats, settlement) |
| `sport_poly_markets` | Mercados esportivos com odds externas da Polymarket |
| `sport_poly_bets` | Apostas em mercados Polymarket |
| `weather_markets` | Mercados de previsão climática |
| `weather_bets` | Apostas de clima |
| `webhook_events` | Log de webhooks (idempotência de pagamentos) |

### Schema de Status

**Apostas (crypto):**
```
pending → paid → won/lost → (withdraw) → withdrawn
                ↓
           expired (após 1 hora sem pagamento)
```

**Mercados (sports):**
```
open → finished → settled
```

### Configuração do DB

- **Database:** `pwsats_db`
- **App user:** `pwsats` (senha: `p4borge55`)
- **Owner user:** `p4borge55` (mesma senha - usado para dumps)
- **Dump versionado:** `db/dump.sql` (8.778 linhas, atualizado a cada commit via git hook)

---

## 💸 Fluxo de Pagamento

### Depósitos (Apostas)

```
1. Usuário seleciona resultado e valor
2. Frontend → POST /api/bet { amountUsd, direction, asset }
3. API → routes/bet.ts
4. API → lib/alby.ts createInvoice() → BOLT11 + paymentHash
5. Frontend exibe QR code + invoice text
6. Usuário paga com carteira Lightning
7. Payment poller (5s) verifica pagamento:
   - Tier 1: LUD-21 verify URL (preferido, funciona com Coinos.io)
   - Tier 2: Alby invoice API fallback (requer AlbyHub + node funded)
8. Pagamento confirmado → bet.status = "paid"
```

### Saques (Payouts)

```
1. Aposta vencedora → withdrawToken gerado
2. Usuário acessa /api/withdraw/:token
3. Retorna LNURL-withdraw URL
4. Usuário escaneia com carteira Lightning
5. Wallet envia invoice para callback
6. API → lib/coinos.ts coinosPayInvoice()
7. Pagamento enviado via Lightning Network
```

### Arquivos de Pagamento

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/alby.ts` | Gera BOLT11 invoices via LNURL-Pay; registra webhook Alby |
| `lib/payment-poller.ts` | Confirmação 2 tiers: LUD-21 polling → Alby API fallback |
| `lib/coinos.ts` | Paga saques de vencedores via Coinos.io |
| `lib/lightning-invoice.ts` | Valida BOLT11: amount exato, expiry |
| `lib/lnurl-withdraw.ts` | Helpers LUD-03 para withdrawals |
| `lib/withdraw-k1.ts` | Deriva nonce k1 seguro para LNURL-Withdraw |
| `routes/webhook.ts` | Recebe notificações Alby (HMAC-verified, idempotente) |

---

## 🎯 Lógica de Mercados

### Crypto Markets (janelas de tempo)

**Arquivo:** `lib/market.ts`

- **Assets suportados:** BTC, ETH, SOL, XRP, BNB
- **Intervalos:** 5, 15, 30 minutos
- **Mecânica:**
  1. Nova janela abre a cada N minutos (ex: :00, :05, :10 para 5min)
  2. Preço de abertura registrado no início
  3. Usuários apostam UP ou DOWN
  4. Janela fecha → preço de fechamento comparado com abertura
  5. Se close > open → UP ganha; se close < open → DOWN ganha
  6. Se close = open → DRAW (todos recebem refund com 0.5% fee)
  7. Se só um lado tem apostas → no liquidity (refund com 0.5% fee)

**Settlement Math:**
```
payout = (betAmount / totalWinningPool) × (totalPool × 0.98)
         └────── pool proporcional ──────   └─ 2% house fee ──┘
```

### Sports Markets (Polymarket)

**Arquivos:** `lib/sports-poly.ts`, `lib/polymarket-sports.ts`

- **Sports suportados:** Soccer, NBA, NFL, MLB, MMA, Rugby, Hockey, Basketball, Tennis, Golf, Cricket, Esports
- **Dados:** Polymarket Gamma API (REST) + WebSocket para scores ao vivo
- **Mercados:** 3-way (home/draw/away) ou 2-way (sem draw)
- **Sync:** A cada 30 segundos busca mercados ativos da Polymarket
- **Settlement:** Poller verifica resolução na Polymarket a cada 15 minutos

**Limitação conhecida:** Desde ~Maio 2026, o WebSocket da Polymarket só envia dados de tênis. Fallback ESPN usado para NBA, NHL, MLB (não cobre Soccer).

### Weather Markets

**Arquivos:** `lib/weather.ts`, `lib/polymarket-weather.ts`

- **Tipos:** Temperatura, Precipitação
- **Settlement:** Automatizado no fechamento da janela (geralmente meia-noite local)
- **Dados:** API de previsão externa com fetching paginado

---

## 🔌 APIs Externas Integradas

| Serviço | Propósito | Configuração |
|---------|-----------|--------------|
| **Alby** | LNURL-Pay invoices, webhook notifications | `ALBY_API_TOKEN`, `LIGHTNING_ADDRESS`, `WEBHOOK_SECRET` |
| **Coinos.io** | Payouts para vencedores (LNURL-Withdraw) | `COINOS_JWT_TOKEN` (obtido manualmente do browser localStorage) |
| **Polymarket Gamma API** | Dados de mercados esportivos e weather | `POLYMARKET_GAMMA_API_BASE` (default: https://gamma-api.polymarket.com) |
| **Polymarket Sports WS** | Scores ao vivo (limitado a tênis desde Maio/2026) | `wss://sports-api.polymarket.com/ws` |
| **CoinGecko / CoinAPI** | Preços crypto para janelas | Chaves configuradas em `lib/price.ts` |
| **ESPN** | Fallback para scores esportivos (NBA, NHL, MLB) | `getEspnMultiSportEvents()` |

---

## 🖥️ Infraestrutura e Deploy

### Ambientes

| Ambiente | Provedor | Domínio | Porta API | BASE_PATH |
|----------|----------|---------|-----------|-----------|
| **Dev** | Aleph Cloud (IPv6) | `*.2n6.me` | 3001 | `/app` |
| **Produção** | OVH (IPv4) | `pwsats.com` | 3001 | `/` |

### Serviços (systemd)

| Serviço | Descrição | Porta |
|---------|-----------|-------|
| `pwsats-api` | API backend (Node.js) | 3001 |
| `pwsats-web` | Frontend (Vite preview) | 3002 |
| `caddy` | Reverse proxy + HTTPS | 80/443 |
| `postgresql` | Banco de dados | 5432 |

### Reverse Proxy (Caddy)

**Dev:** 2 site blocks
- `pwsats.com` → `/app/*` → Vite (3002), `/api/*` → API (3001)
- `*.2n6.me` → `/` → baal-agent (8080)

**Produção:** 1 site block
- `pwsats.com` → `/` → static files (dist/public) + API proxy

**⚠️ Importante:** Nunca editar `/etc/caddy/Caddyfile` diretamente (é sobrescrito no deploy). Usar `/etc/caddy/conf.d/*.caddy` para snippets.

### Deploy

**Scripts disponíveis:**
- `scripts/deploy-to-production.sh` - Deploy completo na produção
- `scripts/start-services.sh` - Gerenciador de serviços (start/restart/status/logs)
- `scripts/backup-prod-db.sh` - Backup do banco de produção
- `scripts/restore-dump-to-production.sh` - Restore do dump versionado

**Auto-sync system:**
- Git post-commit hook atualiza `db/dump.sql` a cada commit
- Dump é force-pushed junto com o código
- Permite disaster recovery e deploy em nova server com 1 comando

---

## 🔐 Segurança

### Medidas Implementadas

1. **Webhook signature verification** - HMAC-SHA256 para verificar webhooks Alby
2. **Idempotência** - `webhook_events` table previne double-processing de pagamentos
3. **Preimage verification** - WebLN endpoint verifica SHA256(preimage) == paymentHash
4. **Session encryption** - Sessions criptografadas
5. **Supply-chain protection** - NPM packages com mínimo 1-day age requirement
6. **Token health monitoring** - Coinos JWT token checado a cada hora, warnings 7 dias antes de expirar

### Arquivos Críticos

| Arquivo | Proteção |
|---------|----------|
| `.env` | Versionado no repo (contém secrets - cuidado!) |
| `db/dump.sql` | Versionado, auto-atualizado |
| `lib/config.ts` | Validação de env vars no startup |
| `routes/webhook.ts` | HMAC verification + idempotency |

---

## 📊 Operações Comuns

### Query no Banco (Dev)
```bash
ssh -i .ssh/id_ed25519 root@<dev-ipv6> '
  PGPASSWORD=p4borge55 psql -U pwsats -d pwsats_dev -h localhost -c "SELECT * FROM sport_poly_markets LIMIT 5;"
'
```

### Query no Banco (Prod)
```bash
ssh -i .ssh/id_ed25519 root@<dev-ipv6> '
  ssh -i ~/.ssh/prd_key -p 24003 root@37.114.37.140 "
    PGPASSWORD=p4borge55 psql -U pwsats -d pwsats_db -h localhost -c \"SELECT sport, count(*) FROM sport_poly_markets GROUP BY sport;\"
  "
'
```

### Verificar Logs (Prod)
```bash
ssh -i .ssh/id_ed25519 root@<dev-ipv6> '
  ssh -i ~/.ssh/prd_key -p 24003 root@37.114.37.140 "
    journalctl -u pwsats-api --no-pager --output=cat --since \"1 hour ago\" | tail -30
  "
'
```

### Health Check
```bash
curl -s https://pwsats.com/api/healthz
curl -s https://pwsats.com/api/market/current?asset=btc
```

---

## 🐛 Troubleshooting Conhecido

### Problemas Comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Mercados não aparecem | API não rodando ou Polymarket sem mercados | Verificar `systemctl status pwsats-api`, testar Gamma API |
| WebSocket só envia tênis | Polymarket mudou comportamento (Maio/2026) | Usar fallback ESPN para NBA/NHL/MLB |
| 429 Rate Limit na Gamma API | Muitos requests paralelos | Reduzir batch size ou aumentar delay |
| Database não existe | DATABASE_URL apontando para DB errado | Dev: `pwsats_dev`, Prod: `pwsats_db` |
| Coinos payouts falhando | JWT token expirado | Refresh token do browser localStorage |
| Webhook não confirma pagamentos | WEBHOOK_URL não registrado no Alby | Registrar manualmente em https://getalby.com/developer/webhooks |

---

## 📝 Environment Variables

### Requeridos

```bash
# API Server
PORT=3001
NODE_ENV=production|development

# Database
DATABASE_URL=postgresql://pwsats:p4borge55@localhost:5432/pwsats_db

# Lightning Payments (Alby)
ALBY_API_TOKEN=<token>
LIGHTNING_ADDRESS=<username>@getalby.com
WEBHOOK_SECRET=<hmac-secret>
WEBHOOK_URL=https://<domain>/api/webhook/alby

# Payouts (Coinos)
COINOS_JWT_TOKEN=<jwt-from-browser>
COINOS_USERNAME=<coinos-username>
COINOS_PASSWORD=<coinos-password>

# Sports API
API_FOOTBALL_KEY=<api-sports-key>

# Sessions
SESSION_SECRET=<random-secret>

# Polymarket
POLYMARKET_GAMMA_API_BASE=https://gamma-api.polymarket.com
POLYMARKET_SPORTS_TAG_ID=<tag-id>
```

---

## 🚀 Comandos Úteis

### Development
```bash
# Install dependencies
pnpm install

# Typecheck
pnpm run typecheck

# Build all packages
pnpm run build

# Run API server (dev mode)
pnpm --filter @workspace/api-server run dev

# Run frontend (dev mode)
pnpm --filter @workspace/predictions-with-sats-web run dev

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client
pnpm --filter @workspace/api-spec run codegen
```

### Production
```bash
# Quick deploy (via jump server)
ssh -i .ssh/id_ed25519 root@<dev-ipv6> '
  ssh -i ~/.ssh/prd_key -p 24003 root@37.114.37.140 "
    cd /opt/Predictions-With-Sats && \
    git pull origin main && \
    cd artifacts/api-server && pnpm build && \
    cd ../predictions-with-sats-web && pnpm build && \
    systemctl restart pwsats-api pwsats-web
  "
'
```

---

## 📚 Documentação Interna

| Arquivo | Propósito |
|---------|-----------|
| `README.md` | Visão geral do projeto, quick start |
| `ARCHITECTURE.md` | Arquitetura detalhada, lifecycle de apostas |
| `AGENTS.md` | Documento orientador para agentes (regras críticas, ambientes, acesso) |
| `docs/AGENT-ONBOARDING.md` | Onboarding completo para novos agentes |
| `docs/vps-deployment-guide.md` | Guia de deploy em VPS |
| `DEPLOY-ALEPH-VM.md` | Deploy em Aleph.im VMs |

---

## 🎯 Pontos de Atenção

### ⚠️ Regras Críticas (do AGENTS.md)

1. **NUNCA clonar o repositório na VM do agente** - Código só no servidor dev e produção. Trabalho via SSH.
2. **NUNCA tomar decisões sem consultar o usuário** - Sempre perguntar antes de implementar, fazer deploy, ou mudar comportamento.
3. **Usar nativamente a API da Polymarket** - Não criar workarounds com fontes externas sem autorização explícita.

### 📌 Limitações Conhecidas

1. **WebSocket Polymarket** - Desde Maio/2026, só envia dados de tênis
2. **ESPN fallback** - Não cobre Soccer (apenas NBA, NHL, MLB)
3. **Coinos JWT token** - Expira em ~3-4 semanas, precisa refresh manual
4. **Rate limits** - Gamma API ~400 req/min, APIs esportivas ~100 req/day

### 🔒 Segurança

1. **.env versionado** - Contém secrets, cuidado ao compartilhar logs
2. **db/dump.sql versionado** - Contém dados reais, não expor publicamente
3. **Chaves SSH** - Armazenadas em `/opt/baal-agent/workspace/.ssh/`

---

## 📈 Métricas e Estatísticas

### Endpoints Públicos

- `GET /api/stats` - Estatísticas da plataforma (total bets, volume, win rate)
- `GET /api/healthz` - Health check
- `GET /api/market/current` - Estado atual do mercado
- `GET /api/sports/markets` - Mercados esportivos abertos

### Dados em Tempo Real

- Poller de pagamentos: a cada 5 segundos
- Poller de settlement sports: a cada 15 minutos
- Sync Polymarket: a cada 30 segundos
- Price snapshots: a cada janela de mercado
- Webhook Alby: push notification (quando configurado)

---

## 📖 Conclusão

O **Predictions With Sats** é um projeto bem estruturado e completo, com:

- ✅ Arquitetura modular e escalável (monorepo pnpm)
- ✅ Integração robusta com Lightning Network (Alby + Coinos)
- ✅ Data fetching otimizado (TanStack Query + OpenAPI auto-gen)
- ✅ Database schema bem organizado (Drizzle ORM)
- ✅ Sistema de auto-deploy com dump versionado
- ✅ Documentação interna extensa (AGENT-ONBOARDING, AGENTS.md)
- ✅ Tratamento de edge cases (no liquidity, draw, refund)
- ✅ Security measures (HMAC, idempotency, preimage verification)

**Pontos fortes:**
- Separação clara entre backend/frontend/libraries
- Geração automática de client code do OpenAPI
- Polling multi-tier para confiabilidade
- Fallbacks para APIs externas
- Logging estruturado (Pino)
- Type-safe end-to-end (TypeScript + Zod)

**Áreas de melhoria potenciais:**
- Dependência do WebSocket da Polymarket (limitado)
- Token manual do Coinos (pode ser automatizado?)
- Rate limiting mais sofisticado para APIs externas

---

*Estudo concluído em 2026-05-22*  
*Agente: p21w05s262108*
