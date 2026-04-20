# Predictions With Sats — Architecture

## Monorepo Structure (pnpm)

```
artifacts/api-server/                  ← Backend Express + Node.js
artifacts/predictions-with-sats-web/   ← Frontend React + Vite
lib/db/                                ← Drizzle ORM schema (PostgreSQL)
lib/api-spec/                          ← OpenAPI (auto-generated)
lib/api-zod/                           ← Zod validation (generated from OpenAPI)
lib/api-client-react/                  ← React hooks (generated from OpenAPI)
```

## Bet Lifecycle (end-to-end)

```
Frontend (bet-modal.tsx)
  └─► POST /api/bet  { amountUsd, direction, asset }
        └─► routes/bet.ts
              └─► lib/alby.ts → createInvoice() → BOLT11 + paymentHash
                    └─► QR code displayed to user
                          └─► user pays with Lightning wallet
                                └─► lib/payment-poller.ts (polls every 5s)
                                      ├─► LUD-21 verifyUrl (Tier 1)
                                      └─► Alby API fallback (Tier 2)
                                            └─► bet.status = "paid"
                                                  └─► market.ts (cron every 5min)
                                                        └─► settleWindow()
                                                              ├─► bet.status = "won" / "lost"
                                                              └─► withdrawToken generated
                                                                    └─► routes/withdraw.ts
                                                                          └─► lib/coinos.ts
                                                                                └─► coinosPayInvoice()
```

---

## Lightning Payment Files

| File | Responsibility |
|---|---|
| `api-server/src/lib/alby.ts` | Generates BOLT11 invoices via LNURL-Pay; registers webhook with Alby |
| `api-server/src/lib/payment-poller.ts` | Two-tier payment confirmation: LUD-21 polling → Alby API fallback |
| `api-server/src/lib/coinos.ts` | Pays winner withdrawals via Coinos.io |
| `api-server/src/lib/lightning-invoice.ts` | Validates BOLT11: exact amount, expiry |
| `api-server/src/lib/lnurl-withdraw.ts` | LUD-03 helpers for wallet-initiated withdrawals |
| `api-server/src/lib/withdraw-k1.ts` | Derives secure `k1` nonce for LNURL-Withdraw |
| `api-server/src/routes/webhook.ts` | Receives Alby push notifications (HMAC-verified, idempotent) |

---

## Market Logic Files

| File | Responsibility |
|---|---|
| `api-server/src/lib/market.ts` | BTC/ETH/SOL price market engine (5-min windows, cron-driven) |
| `api-server/src/lib/sports-market.ts` | Sports engine (Football, NBA, NFL, MMA…) via TheSportsDB |
| `api-server/src/lib/sports-poly.ts` | Sports markets with Polymarket external odds |
| `api-server/src/lib/weather.ts` | Temperature markets (Yes/No via Polymarket) |
| `api-server/src/lib/sports-pollers.ts` | Cron: fetches sport events and detects results |
| `api-server/src/lib/sports-poly-pollers.ts` | Cron: syncs Polymarket markets every 5 min |

---

## Database Schema

| File | Table / Purpose |
|---|---|
| `lib/db/src/schema/market-windows.ts` | Price windows: `status`, `openPrice`, `closePrice`, `outcome`, `totalUpSats`, `totalDownSats` |
| `lib/db/src/schema/bets.ts` | Price bets: `paymentHash`, `verifyUrl`, `status`, `withdrawToken`, `withdrawStatus` |
| `lib/db/src/schema/sport-markets.ts` | Sport events with per-outcome pools |
| `lib/db/src/schema/sport-poly-markets.ts` | Polymarket sports (outcomes as JSONB with external `price`) |
| `lib/db/src/schema/weather-markets.ts` | Weather markets with temperature `threshold` |
| `lib/db/src/schema/webhook-events.ts` | Idempotency: prevents double-processing a payment |

---

## Frontend Files

| File | Responsibility |
|---|---|
| `web/src/pages/home.tsx` | BTC/ETH/SOL predictions with live chart and active window |
| `web/src/pages/sports.tsx` | Sports market betting |
| `web/src/pages/weather.tsx` | Weather market betting |
| `web/src/components/bet-modal.tsx` | Bet modal: USD→Sats conversion, QR display, WebLN support |
| `web/src/components/my-bet-widget.tsx` | Tracks user bets via localStorage + status polling |
| `web/src/lib/payout-preview.ts` | Simulates estimated payout before bet confirmation |

---

## Settlement Math

The same formula applies to all market types (price, sports, weather):

```
payout = (betAmount / totalWinningPool) × (totalPool × 0.98)
         └─────── proportional ─────────   └── 2% house fee ──┘

edge case: if only one side bet → refund with 0.5% fee
```

Polymarket is used only as a **source of external odds** for user context — internal pools are independent and settled in sats.

---

## Key API Routes

```
GET  /api/market/current?asset=btc        active window + price + pool totals
GET  /api/market/history?asset=btc        settled windows with outcomes
POST /api/bet                             create price prediction bet → invoice
GET  /api/bet/:paymentHash                bet status + withdraw info
POST /api/bet/:paymentHash/verify-preimage  WebLN preimage verification
GET  /api/withdraw/:token                 LNURL-Withdraw init (LUD-03)
GET  /api/withdraw/:token/callback        wallet submits invoice → paid via Coinos
POST /api/webhook/alby                    Alby payment settled push notification
GET  /api/sports/events?sport=football    upcoming/finished sport events
GET  /api/sports/markets                  open sport markets with pool totals
POST /api/sports/bets                     place sport bet
GET  /api/sports-poly/markets             Polymarket sports with external odds
POST /api/sports-poly/bets                place Polymarket sport bet
GET  /api/weather/markets                 open weather markets
POST /api/weather/bets                    place weather bet
GET  /api/stats                           platform aggregates
```

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `LIGHTNING_ADDRESS` | Receiving Lightning address (e.g. `user@coinos.io`) |
| `ALBY_API_TOKEN` | Alby REST API token for webhook management |
| `WEBHOOK_SECRET` | HMAC secret to verify Alby webhook signatures |
| `COINOS_JWT_TOKEN` | JWT for Coinos.io outbound winner payouts |
| `WEBHOOK_URL` | Full URL of webhook endpoint for auto-registration |
