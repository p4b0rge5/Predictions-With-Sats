# Predictions With Sats

Prediction market platform where users bet **Bitcoin (sats)** on outcome events — crypto price direction, sports matches, and weather forecasts. Payments are processed via the **Lightning Network** through Coinos.io.

## Quick Summary

| | |
|---|---|
| **Stack** | TypeScript, pnpm monorepo, React 19, Express 5, PostgreSQL, Drizzle ORM |
| **Payments** | Lightning Network (LNURL-pay) — deposits & payouts via Coinos.io |
| **Deployment** | Debian 12 / Ubuntu 22.04, systemd services, nginx (or Caddy), IPv6 dual-stack |
| **Fee** | 2 % house fee per market |
| **Repo** | https://github.com/p4borge55/Predictions-With-Sats |

---

## Project Structure

```
Predictions-With-Sats/
├── artifacts/
│   ├── api-server/              # Express 5 REST API (port 3001)
│   │   └── src/
│   │       ├── routes/          # API endpoints
│   │       │   ├── bet.ts       #   /bet — crypto bets
│   │       │   ├── market.ts    #   /market — market state & history
│   │       │   ├── sports.ts    #   /sports — events, markets, bets
│   │       │   ├── weather.ts   #   /weather — weather markets & bets
│   │       │   ├── sports-poly.ts  # /sports-poly — expanded sports markets
│   │       │   ├── withdraw.ts    # /withdraw — LNURL-withdraw payouts
│   │       │   ├── webhook.ts     # /webhook — Alby webhook for payment confirmation
│   │       │   ├── stats.ts       # /stats — platform statistics
│   │       │   └── health.ts      # /healthz — health check
│   │       └── lib/               # Business logic
│   │           ├── market.ts          # Crypto market window system (5/15/30 min)
│   │           ├── price.ts           # Live price fetching (CoinGecko / CoinAPI)
│   │           ├── sports.ts          # Football data (api-sports.io)
│   │           ├── nba.ts             # NBA data
│   │           ├── nfl.ts             # NFL data (with off-season guard)
│   │           ├── mma.ts             # MMA/UFC data
│   │           ├── rugby.ts           # Rugby data
│   │           ├── hockey.ts          # Hockey data
│   │           ├── weather.ts         # Weather market data
│   │           ├── coinos.ts          # Coinos.io Lightning client (payouts)
│   │           ├── lightning-invoice.ts # Bolt11 invoice generation
│   │           ├── lnurl-withdraw.ts  # LNURL-withdraw payout generation
│   │           ├── payment-poller.ts  # Two-tier payment verification (LUD-21 + Alby)
│   │           ├── sports-pollers.ts  # Settlement polling (force-refresh + direct lookup)
│   │           ├── weather-pollers.ts # Weather settlement polling
│   │           └── external-*.ts      # External data source integration
│   │
│   ├── predictions-with-sats-web/   # React 19 frontend (Vite, port 3002)
│   │   └── src/
│   │       ├── pages/               # Route pages
│   │       │   ├── home.tsx         # Landing / home
│   │       │   ├── sports.tsx       # Sports betting (multi-sport tabs)
│   │       │   ├── weather.tsx      # Weather betting
│   │       │   ├── history.tsx      # Crypto bet history
│   │       │   ├── my-bets.tsx      # Global My Bets dashboard
│   │       │   └── guide.tsx        # User guide
│   │       └── components/
│   │           ├── my-bet-widget.tsx  # Per-category bet storage & display
│   │           ├── bet-modal.tsx      # Bet placement modal (LN invoice QR)
│   │           └── ui/                # Shared UI components (shadcn/ui)
│   │
│   └── mockup-sandbox/              # UI mockup tool for design iterations
│
├── lib/                              # Shared packages
│   ├── db/                           # PostgreSQL schema (Drizzle ORM)
│   │   └── src/schema/
│   │       ├── market-windows.ts     # Crypto market windows
│   │       ├── bets.ts              # Crypto bets
│   │       ├── price-snapshots.ts   # Historical price snapshots
│   │       ├── sport-markets.ts     # Sports markets
│   │       ├── sport-bets.ts        # Sports bets
│   │       ├── sport-poly-markets.ts # Expanded sports markets
│   │       ├── sport-poly-bets.ts   # Expanded sports bets
│   │       ├── weather-markets.ts   # Weather markets
│   │       ├── weather-bets.ts      # Weather bets
│   │       └── webhook-events.ts    # Webhook event log
│   │
│   ├── api-client-react/            # React Query hooks (generated from OpenAPI)
│   ├── api-spec/                     # OpenAPI spec + Orval codegen config
│   └── api-zod/                      # Zod schemas (generated from OpenAPI)
│
├── scripts/                          # Operational scripts
│   ├── install-clean.sh             # Full automated installation (one-liner)
│   ├── install-production.sh        # Production-focused install
│   └── start-services.sh            # Service manager (start/restart/status/logs)
│
├── db/
│   └── dump.sql                      # Auto-generated DB dump (updated every commit)
│
├── .env                              # Configuration (versioned in repo)
├── .env.example                      # Template
└── DEPLOY-ALEPH-VM.md               # Deployment guide for Aleph.im VMs
```

---

## Categories

### 📈 Crypto

Bet on whether a cryptocurrency's price will go **up** or **down** within a fixed time window.

- **Assets:** BTC, ETH, SOL, XRP, BNB
- **Intervals:** 5 min, 15 min, 30 min
- **Prices from:** CoinGecko / CoinAPI
- **Mechanics:** A new window opens every N minutes. The opening price is recorded. At window close, bets are settled based on whether the closing price is above or below the opening price.

### ⚽ Sports

Bet on the outcome of real-world sports matches. Data sourced from **api-sports.io** with expanded market coverage.

| Sport | Draw? | Key Details |
|---|---|---|
| **Football** (Soccer) | ✅ | European elite leagues, 110 min expected duration |
| **NBA** | ❌ | Regular season + playoffs, 150 min expected duration |
| **NFL** | ❌ | American Football, 240 min, off-season guard (Apr–Jul) |
| **MLB** | ❌ | Baseball, off-season guard (Dec–Feb) |
| **MMA** | ❌ | UFC, Bellator, ONE Championship, PFL |
| **Rugby** | ✅ | Six Nations, Rugby Championship, Premiership, Top 14, URC, Super Rugby |
| **Hockey** | ❌ | NHL and international leagues |
| **Basketball** | ❌ | International leagues (non-NBA) |

**Settlement:** Three-layer defence — cache force-refresh → overdue market detection → direct single-event API lookup. Each provider is capped at 100 requests/day.

### 🌡️ Weather

Bet on whether actual temperature/precipitation will be above or below forecasted values.

- **Types:** Temperature, Precipitation
- **Settlement:** Automated at window close time (typically midnight local time)
- **Data:** External forecasting API with paginated market fetching

---

## Database Schema

10 PostgreSQL tables managed by Drizzle ORM:

| Table | Purpose |
|---|---|
| `market_windows` | Crypto market windows (asset, interval, open/close timestamps, prices) |
| `bets` | Crypto bets (payment hash, sats, direction, status, settlement) |
| `price_snapshots` | Historical crypto price data |
| `sport_markets` | Sports match markets (eventId, home/away, start time, status) |
| `sport_bets` | Sports bets (linked to market, direction, sats, settlement) |
| `sport_poly_markets` | Expanded sports markets |
| `sport_poly_bets` | Expanded sports bets |
| `weather_markets` | Weather forecast markets |
| `weather_bets` | Weather bets |
| `webhook_events` | Webhook request log (signature verification, payload) |

---

## Payment Flow

### Deposits (Bets)

1. User selects an outcome and stake amount
2. API generates a **Lightning invoice** (Bolt11) via Coinos.io
3. Invoice is shown as QR code + text in the bet modal
4. **Payment verification** (two-tier):
   - **Tier 1:** LUD-21 verify URL — poll every 5s (recommended with Coinos.io)
   - **Tier 2:** Alby invoice API fallback (requires AlbyHub + funded node)
5. On confirmed payment → bet is recorded in DB

### Withdrawals (Payouts)

1. Winning bet generates a **withdraw token**
2. User opens the withdraw link → receives an **LNURL-withdraw** URL
3. LNURL decoder prompts for Lightning deposit address
4. Coinos.io sends the payout via Lightning Network

---

## Configuration (`.env`)

```bash
# Server
PORT=3001
NODE_ENV=production
BASE_PATH=/pwsatsapi
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://pwsats:password@localhost:5432/pwsats_db

# Lightning Payments
ALBY_API_TOKEN=...
LIGHTNING_ADDRESS=username@coinos.io

# Webhook
WEBHOOK_SECRET=...
WEBHOOK_URL=https://your-domain.com/pwsatsapi/webhook/alby
PUBLIC_BASE_URL=https://your-domain.com
API_BASE_PATH=/pwsatsapi

# Coinos.io (payouts)
COINOS_JWT_TOKEN=...        # obtained manually from browser localStorage
COINOS_PASSWORD=...
COINOS_USERNAME=...

# Sports API
API_FOOTBALL_KEY=...

# Sessions
SESSION_SECRET=...
```

> **Note:** `.env` is versioned in this repository — not in `.gitignore`. The database dump (`db/dump.sql`) is also versioned and auto-updated on every commit via a git hook.

---

## Development

```bash
# Install dependencies
pnpm install

# Typecheck
pnpm run typecheck

# Build all packages
pnpm run build

# Run API server (dev mode with hot reload)
pnpm --filter @workspace/api-server run dev

# Run frontend (dev mode)
pnpm --filter @workspace/predictions-with-sats-web run dev

# Push DB schema changes
pnpm --filter @workspace/db run push

# Regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

---

## Deployment

### Quick Install (One-Liner)

```bash
bash scripts/install-clean.sh
```

This script handles: system dependencies (Node 24, pnpm, PostgreSQL, nginx, Tor) → pnpm install → build → PostgreSQL user/DB creation → Drizzle schema push → SSL cert → nginx HTTPS → systemd service registration.

### Aleph.im VM Deployment

See [`DEPLOY-ALEPH-VM.md`](DEPLOY-ALEPH-VM.md) for the full guide including IPv6 configuration, DNS setup, and database restore from the versioned dump.

### Manual Service Setup

```bash
# API server
systemctl start pwsats-api
systemctl enable pwsats-api

# Web frontend (Vite preview)
systemctl start pwsats-web
systemctl enable pwsats-web
```

### Reverse Proxy

The app is designed to run behind a reverse proxy (nginx or Caddy) at a **base path** (e.g. `/pwsats/`). Both `BASE_PATH` (API) and `API_BASE_PATH` environment variables configure the routing prefix.

---

## Auto-Sync System

A git `post-commit` hook (`hooks/post-commit`) runs automatically after every commit:

1. Generates a fresh PostgreSQL dump → `db/dump.sql`
2. Amends the commit with the updated dump
3. Force-pushes to the remote

This ensures the repository always contains the latest state of both code and data — critical for disaster recovery and deploying to a new server.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Language** | TypeScript 5.9 |
| **Package Manager** | pnpm workspaces + catalog |
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, framer-motion, shadcn/ui |
| **Data Fetching** | TanStack Query (auto-generated from OpenAPI spec via Orval) |
| **API** | Express 5, Pino logger |
| **Validation** | Zod v4 (auto-generated schemas) |
| **Database** | PostgreSQL + Drizzle ORM |
| **Payments** | Lightning Network via Coinos.io (Bolt11 + LNURL-pay/withdraw) |
| **Scheduling** | node-cron (settlement polling, market windows, price snapshots) |
| **Build** | esbuild (CJS bundle for API), Vite (frontend) |
| **Security** | Supply-chain protection (minimum 1-day npm release age), session encryption, webhook signature verification |
