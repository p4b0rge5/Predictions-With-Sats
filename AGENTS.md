# AGENTS.md — Predictions With Sats (PWSats)

> **Documento orientador para novos agentes.** Leia este antes de qualquer outra ação.

---

## 1. O QUE É O PROJETO

**Predictions With Sats (PWSats)** é uma plataforma de apostas descentralizada que permite apostar com Lightning Network (sats) em mercados de esportes da Polymarket e outros (crypto, weather).

- **Repositório**: https://github.com/p4b0rge5/Predictions-With-Sats
- **Domínio público**: https://pwsats.com
- **Tech stack**: TypeScript, Node.js, Drizzle ORM, PostgreSQL, React (Vite), Lightning Charge
- **Monorepo pnpm**: `artifacts/api-server` (backend) + `artifacts/predictions-with-sats-web` (frontend)

### ⚠️ REGRAS CRÍTICAS

1. **NUNCA clone o repositório na VM do agente.** O código está só no servidor dev e no servidor de produção. Todo trabalho é feito via SSH.
2. **NUNCA tome decisões sem consultar o usuário.** Sempre pergunte antes de implementar, fazer deploy, ou mudar comportamento.
3. **Use nativamente a API da Polymarket.** Não crie workarounds com fontes externas (ESPN, APIs de terceiros) sem autorização explícita do usuário. Se a API não fornece algo, reporte ao usuário.

---

## 2. AMBIENTES E ACESSO

### 2.1 Servidor de Desenvolvimento (Dev)

| Campo | Valor |
|---|---|
| **IP** | `2602:294:0:66d:3:fa3e:5395:3001` (IPv6, Aleph Cloud) |
| **Usuário** | `root` |
| **SSH key** | `/opt/baal-agent/workspace/.ssh/id_ed25519` (na VM do agente) |
| **Projeto** | `/opt/baal-agent/workspace/pwsats-local` |
| **DB** | PostgreSQL `postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev` |
| **Serviço API** | `systemctl status pwsats-api` (porta 3001) |
| **Caddy** | Reverse proxy com snippets em `/etc/caddy/conf.d/pwsats.caddy` |
| **Domínio dev** | `when-verb-torch-gas.2n6.me` (apenas para testes do agente) |

**Acesso direto da VM do agente:**
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001
```

### 2.2 Servidor de Produção (Prod)

| Campo | Valor |
|---|---|
| **IP** | `37.114.37.140` (OVH, IPv4) |
| **Porta SSH** | `24003` |
| **Usuário** | `root` |
| **Domínio** | `pwsats.com` |
| **Projeto** | `/opt/Predictions-With-Sats` |
| **DB** | PostgreSQL `postgresql://pwsats:p4borge55@localhost:5432/pwsats_db` |
| **Serviços** | `pwsats-api` (3001), `pwsats-web` (3002), `caddy` |
| **NODE_ENV** | `development` (por padrão no `.env`) |

**⚠️ IMPORTANTE:** Não há acesso direto à produção da VM do agente. O acesso é **somente via jump** pelo servidor dev:

```bash
# Da VM do agente → dev → prod (um único comando):
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    # Comandos aqui rodam NA produção
    cd /opt/Predictions-With-Sats && git status
  "
'
```

A chave SSH para produção (`prd_key`) está **só no servidor dev** em `~/.ssh/prd_key`.

### 2.3 Diferenças Dev vs Prod

| Aspecto | Dev | Prod |
|---|---|---|
| DB name | `pwsats_dev` | `pwsats_db` |
| Frontend | Caddy serve `dist/public` direto | Serviço `pwsats-web` (vite preview) |
| Caddy | Snippets em `conf.d/*.caddy` | Caddyfile próprio em `/etc/caddy/Caddyfile` |
| Domínio | `when-verb-torch-gas.2n6.me` | `pwsats.com` |

---

## 3. COMO FUNCIONA O PROJETO

### 3.1 Arquitetura

```
┌─────────────┐    HTTPS    ┌────────────────┐
│   Browser    │ ──────────► │     Caddy      │
│  (pwsats.com)│             │  Reverse Proxy  │
└─────────────┘             └──────┬─────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              /app/* │        /api/* │    /assets/*  │
                    │               │               │
              Vite dev     Node API      Static files
              (port 3002)  (port 3001)  (dist/public)
                    │               │
                    │         PostgreSQL
                    │         (port 5432)
                    │
         External APIs:
         - Polymarket Gamma API (REST)
         - Polymarket Sports WS (scores)
         - Lightning Network (Charge server)
         - Polygon blockchain
```

### 3.2 Módulos Principais do Backend (`artifacts/api-server`)

#### Sports Markets Sync (`sports-poly-sync.ts`)
- Busca mercados ativos da Polymarket via Gamma API
- Usa `tag_id` para filtrar por esporte (soccer, MLB, NHL, etc.)
- Salva no banco em `sport_poly_markets` e `sport_poly_bets`
- Roda a cada 30 segundos

#### Sports WS Scores (`sports-ws-scores.ts`)
- Conecta ao WebSocket da Polymarket: `wss://sports-api.polymarket.com/ws`
- Recebe scores em tempo real de jogos ao vivo
- **Limitação conhecida:** desde ~Maio 2026, o WS só envia dados de tênis
- Atualiza `home_score`/`away_score` no banco

#### Sports Settlement (`sports-settlement.ts`)
- Verifica quando mercados são resolvidos na Polymarket
- Calcula payouts e atualiza status para `settled`
- Integra com Lightning para pagar vencedores

#### Sports Pollers (`sports-pollers.ts`)
- Poller de pagamento: checa pagamentos pendentes a cada 5s
- Poller de settlement: roda a cada 15 minutos

#### Poly Score Sync (`poly-score-sync.ts`)
- **Fallback ESPN** para quando o WS da Polymarket não tem dados
- Usa `getEspnMultiSportEvents()` para NBA, NHL, MLB
- **Não cobre Soccer** (ESPN multi-sport não tem dados de soccer)

### 3.3 Frontend (`artifacts/predictions-with-sats-web`)

- React + Vite com Material UI
- Rotas principais:
  - `/app/sports` — lista de mercados de esportes
  - `/app/crypto` — mercados de crypto
  - `/app/weather` — mercados de clima
  - `/app/sports/[id]` — detalhes de um mercado individual

---

## 4. DEPLOY

### 4.1 Deploy no Dev Server

```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  cd /opt/baal-agent/workspace/pwsats-local && \
  git pull origin main && \
  cd artifacts/api-server && pnpm build && \
  systemctl restart pwsats-api
'
```

> O frontend no dev é servido pelo Caddy a partir de `dist/public`. Se mudou algo no frontend, fazer também `cd ../predictions-with-sats-web && pnpm build`.

### 4.2 Deploy na Produção (via jump)

```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    cd /opt/Predictions-With-Sats && \
    git pull origin main && \
    cd artifacts/api-server && pnpm build && \
    cd ../predictions-with-sats-web && pnpm build && \
    systemctl restart pwsats-api && \
    systemctl restart pwsats-web
  "
'
```

### 4.3 Checklist de Deploy

1. ✅ Testar mudanças no dev primeiro
2. ✅ Verificar `git log --oneline -5` no dev
3. ✅ Push para GitHub (`git push origin main`)
4. ✅ Fazer deploy na produção via jump
5. ✅ Verificar logs: `journalctl -u pwsats-api --no-pager -n 50`
6. ✅ Testar endpoint: `curl -s https://pwsats.com/api/sports/markets | python3 -m json.tool | head -20`

---

## 5. OPERAÇÕES COMUNS

### 5.1 Query no Banco (Dev)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  PGPASSWORD=p4borge55 psql -U pwsats -d pwsats_dev -h localhost -c "SELECT * FROM sport_poly_markets LIMIT 5;"
'
```

### 5.2 Query no Banco (Prod)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    PGPASSWORD=p4borge55 psql -U pwsats -d pwsats_db -h localhost -c \"SELECT sport, count(*) FROM sport_poly_markets GROUP BY sport;\"
  "
'
```

### 5.3 Verificar Logs (Prod)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    journalctl -u pwsats-api --no-pager --output=cat --since \"1 hour ago\" | tail -30
  "
'
```

### 5.4 Status dos Serviços (Prod)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 '
  ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "
    systemctl is-active pwsats-api pwsats-web caddy postgresql
  "
'
```

### 5.5 Verificar Mercado na Polymarket (via Gamma API)
```bash
curl -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://polymarket.com" \
  "https://gamma-api.polymarket.com/markets?limit=5&active=true&closed=false&order=volume&ascending=false"
```

---

## 6. TROUBLESHOOTING

### 6.1 "database does not exist"
Verificar `DATABASE_URL` no `.env`:
- Dev: deve ser `postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev`
- Prod: deve ser `postgresql://pwsats:p4borge55@localhost:5432/pwsats_db`
- **Erro comum:** apontar para o database errado (`pwsats_dev` na produção)

### 6.2 Mercados não aparecem
1. Verificar se `pwsats-api` está rodando: `systemctl status pwsats-api`
2. Verificar se há mercados no banco: `SELECT count(*) FROM sport_poly_markets;`
3. Verificar se a Polymarket tem mercados ativos: testar o Gamma API
4. Verificar logs de erro: `journalctl -u pwsats-api --no-pager -n 50`

### 6.3 WS da Polymarket só envia dados de tênis
- **Conhecido desde ~Maio 2026.** O endpoint `wss://sports-api.polymarket.com/ws` mudou comportamento
- O fallback ESPN (`poly-score-sync.ts`) cobre NBA, NHL, MLB
- Soccer não tem fallback (ESPN multi-sport não cobre)
- Solução: monitorar se a Polymarket restaura o WS ou mudar abordagem

### 6.4 429 Rate Limit na Gamma API
- A Polymarket rate limita a API REST para ~400 requests/min
- O sync faz múltiplas chamadas paralelas por tag
- Mitigação: reduzir batch size ou aumentar delay entre chamadas

---

## 7. WORKFLOW DO AGENTE

### 7.1 O que você pode fazer
- ✅ Acessar dev e prod via SSH
- ✅ Fazer deploy no dev e prod
- ✅ Query e debug no banco PostgreSQL
- ✅ Ver logs e status de serviços
- ✅ Testar endpoints da API
- ✅ Gerar imagens com `generate_image`
- ✅ Buscar informações na web com `web_fetch` e `web_search`
- ✅ Criar scripts Python para análise

### 7.2 O que você NÃO deve fazer
- ❌ Clonar o repositório na VM do agente
- ❌ Editar `/etc/caddy/Caddyfile` (pertence ao deployer)
- ❌ Parar o serviço `baal-agent`
- ❌ Dumpar variáveis de ambiente (contém secrets)
- ❌ Ler arquivos `.env` (contém tokens e chaves)
- ❌ Fazer mudanças irreversíveis sem confirmar com o usuário
- ❌ Criar dependências externas sem autorização

### 7.3 Skills disponíveis
Skills em `/opt/baal-agent/workspace/skills/` contêm procedimentos detalhados:
- **dev-db-query**: Query segura no PostgreSQL
- **dev-server-deploy**: Deploy completo no dev
- **prod-deploy**: Deploy na produção via jump
- **prod-down-troubleshoot**: Servidor fora do ar
- **prod-settlement-troubleshoot**: Markets não resolvendo
- **ws-scores-debug**: WS da Polymarket com problemas
- **revert-to-commit**: Rollback para commit específico
- **code-review**: Review de código
- **debugging**: Debug sistemático

---

## 8. ESTILO DE COMUNICAÇÃO

- **Linguagem:** Português (Brasil)
- **Estilo:** Conciso, técnico, direto
- **Sempre:** Informar o que foi feito, o que está funcionando, o que precisa atenção
- **Sempre:** Perguntar antes de fazer deploy na produção
- **Sempre:** Relatar erros com contexto (logs, comandos, output)

---

## 9. ARQUITETURA DO BANCOD DE DADOS

### Tabelas principais
```sql
sport_poly_markets
  ├── id (PK, sequence)
  ├── external_market_id (único, da Polymarket)
  ├── sport ('Soccer', 'Basketball', 'Baseball', 'Hockey', 'Sports')
  ├── event_name
  ├── home_team, away_team
  ├── home_score, away_score
  ├── status ('open', 'settled')
  ├── is_live (boolean)
  ├── starts_at, ends_at
  ├── created_at, updated_at

sport_poly_bets
  ├── id (PK)
  ├── market_id (FK → sport_poly_markets)
  ├── direction ('home', 'away', 'draw')
  ├── outcome_label
  ├── amount_sats
  ├── payment_hash, payment_request, verify_url
  ├── status ('pending', 'paid', 'settled', 'lost')
  ├── payout_sats
  ├── withdraw_token, withdraw_status
  ├── created_at, paid_at, settled_at
```

---

## 10. ATALHOS ÚTEIS

```bash
# === Dev ===
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001

# === Prod (via jump) ===
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 "bash"'

# === Quick deploy prod ===
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 \
  "cd /opt/Predictions-With-Sats && git pull origin main && cd artifacts/api-server && pnpm build && cd ../predictions-with-sats-web && pnpm build && systemctl restart pwsats-api pwsats-web"'

# === Health check prod ===
curl -s -o /dev/null -w "%{http_code}" https://pwsats.com/api/sports/markets
```

---

*Documento criado: 2026-05-18*
*Mantido por: p17w05s260145*
