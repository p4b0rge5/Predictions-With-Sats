---
name: prod-settlement-troubleshoot
description: Troubleshoot why Poly sports markets are not settling on production. Covers DB connection issues, sequence collisions, sync failures, and manual resolution. Use when markets show as "open" or "EVENT IMMINENT" but the game is already finished.
---

# Prod Settlement Troubleshooting

## Symptom
Markets show as "open" with scores visible but not marked as settled, or show "EVENT IMMINENT" when the game is finished.

## Step 1: Check DB Connection
The most common cause — service connected to wrong database.

```bash
# Check if .env has correct DATABASE_URL
grep DATABASE_URL /opt/Predictions-With-Sats/.env
# Should be: pwsats_db (NOT pwsats_dev)

# Check service logs for "does not exist" errors
journalctl -u pwsats-api --no-pager --since "12 hours ago" | grep "does not exist"
# Look for: error: database "pwsats_dev" does not exist
```

**Fix:** Update `.env` DATABASE_URL and restart service.

## Step 2: Check Sequence State
If sync fails with "duplicate key value violates unique constraint sport_poly_markets_pkey":

```bash
sudo -u postgres psql -d pwsats_db -c "
SELECT last_value FROM sport_poly_markets_id_seq;
SELECT max(id) FROM sport_poly_markets;
"
# last_value should be >= max(id)

# Fix if desynced:
SELECT setval('sport_poly_markets_id_seq', (SELECT max(id) FROM sport_poly_markets));
```

## Step 3: Check Sync Status
```bash
# Look for poly sync errors
journalctl -u pwsats-api --no-pager --since "1 hour ago" | grep -i "poly\|gamma\|sync.*fail\|duplicate" | grep -v "sports-poly/markets"
```

Key log patterns:
- `Sports Poly pollers started` — sync is running
- `Sports Poly payment poller error: password authentication failed` — DB connection issue
- `Sports Poly market sync failed: duplicate key` — sequence or insert issue
- No poly logs at all — sync may be blocked by TTL (15min) or failing silently

## Step 4: Check Polymarket API Directly
```bash
curl -s -H "User-Agent: Mozilla/5.0" -H "Referer: https://polymarket.com/" \
  "https://gamma-api.polymarket.com/events?slug={slug}" | python3 -m json.tool
```

Key fields:
- `closed: true` — market is closed on Polymarket
- `markets[].outcomePrices: ["1", "0"]` — first outcome won (100%/0%)
- `markets[].outcomePrices: ["0", "1"]` — second outcome won
- `markets[].tokens[].winner: true` — token-level winner (may be null for NegRisk markets)

## Step 5: Manual Settlement
If Polymarket API confirms resolution but our sync can't reach the market:

```sql
UPDATE sport_poly_markets
SET status = 'settled',
    winning_outcome = 'home',  -- or 'away' or 'draw'
    resolved_value = 'Team Name wins',
    settled_at = '2026-05-18T03:00:00Z',
    outcomes = '[{"key":"home","label":"Team","price":100,"isWinner":true,...},...]'
WHERE id = {market_id};
```

The next `settleResolvedSportsPolyMarkets()` cycle (within 15min) will process payouts for any `paid` bets.

## Step 6: Check Bets on Market
```bash
sudo -u postgres psql -d pwsats_db -c "
SELECT b.id, b.market_id, b.direction, b.amount_sats, b.status, b.payout_sats, m.event_name
FROM sport_poly_bets b
JOIN sport_poly_markets m ON b.market_id = m.id
WHERE b.market_id = {market_id};
"
```

## Common Causes Summary
| Cause | Symptom | Fix |
|-------|---------|-----|
| Wrong DB in .env | `database does not exist` in logs | Fix DATABASE_URL, restart |
| Sequence desync | `duplicate key ... pkey` error | `SELECT setval(...)` to max(id) |
| Closed markets not in feed | Sync succeeds but market stays open | Manual update or increase MAX_CLOSED_PAGES |
| Polymarket hasn't resolved | `outcomePrices` still shows odds | Wait — Polymarket must resolve first |
| Nostr/DB auth issues | `password authentication failed` | Check PostgreSQL pg_hba.conf |

## Settlement Flow Reference
```
Polymarket Gamma API (polling ~30min)
  → getYesInfo() detects winner: token.winner=true OR price ≥ 99%
  → DB update: status="settled", winningOutcome="home/away/draw"
  → settleResolvedSportsPolyMarkets() iterates DB markets with winningOutcome
  → settleSportsPolyMarket(id) distributes payout to winners
```
