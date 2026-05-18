---
name: ws-scores-debug
description: Diagnose why real-time sports scores from Polymarket WebSocket are not updating. Covers WS connection, DB state, API rate limits, EROFS, and the known tennis-only issue.
---

# WS Scores Debug

## Context
- WS connects to `wss://sports-api.polymarket.com/ws`
- Confirmed issue (May 2026): **Polymarket WS only sends tennis data** (grand slam, challenger, ATP), not soccer/NBA/MLB/NHL
- Only logs `INFO` when scores are saved to DB (matching markets found)
- Commit `88101e2b` added INFO-level logging to onmessage to see inbound data

## Quick Diagnostic (one command)

```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'journalctl -u pwsats-api --no-pager --output=cat --since "2 min ago" | grep "message received"'
```

Expected healthy output (tennis-only confirmed):
- `league: "grand slam"` or `"challenger"` or `"atp"` — all tennis
- No NBA, NHL, MLB, soccer leagues

## Step-by-Step

### 1. Check WS connection state
```bash
ssh ... 'journalctl -u pwsats-api --no-pager --since "1 hour ago" | \
  grep -E "Sports WS.*(starting|connected|stopped|disconnected|reconnect)" | grep -v EROFS'
```
- `starting` → `connected` = good
- `disconnected` + `reconnect` = unstable connection

### 2. Check what data WS is actually receiving
```bash
ssh ... 'journalctl -u pwsats-api --no-pager --output=cat --since "2 min ago" | grep "message received"'
```
If all messages show `league: "grand slam"` or `"challenger"` or `"atp"` → confirmed tennis-only.

### 3. Check DB for tennis markets (what WS can actually update)
```bash
ssh ... 'psql postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev -c \
  "SELECT count(*) FROM sport_poly_markets WHERE league ILIKE '\''%tennis%'\'' AND status = '\''open'\'';"'
```
If 0 → WS has nothing to update.

### 4. Check DB for non-tennis markets needing scores
```bash
ssh ... 'psql ... -c "SELECT league, count(*) FROM sport_poly_markets WHERE status = '\''open'\'' GROUP BY league HAVING count(*) > 5 ORDER BY count DESC;"'
```

### 5. Check if any scores are being saved
```bash
ssh ... 'journalctl -u pwsats-api --no-pager --since "30 min ago" | grep "markets updated"'
```

### 6. Check REST API rate limiting
```bash
ssh ... 'journalctl -u pwsats-api --no-pager --since "10 min ago" | grep -c "HTTP 429"'
```

### 7. Check EROFS noise (harmless)
```bash
ssh ... 'journalctl -u pwsats-api --no-pager --since "5 min ago" | grep -c "EROFS"'
```
EROFS errors from `sports-request-budget.json` are cosmetic — budget tracker fails on read-only FS.

## Known Issues

| Issue | Impact | Status |
|---|---|---|
| Polymarket WS only sends tennis data | Scores not updating for soccer/NBA/MLB/NHL | ⚠️ Confirmed May 2026 |
| REST API HTTP 429 rate limits | Market fetch fails, no fallback | ⚠️ Ongoing |
| EROFS on `.runtime/` files | Budget tracker can't persist, noisy logs | ⚠️ Cosmetic |

## Fix Options
1. **Add tennis markets to DB** — WS would work for tennis matches
2. **ESPN fallback** — commit `ac7e8630` has `poly-score-sync.ts` using ESPN for NBA/NHL/MLB
3. **Investigate Polymarket WS** — endpoint change? New auth? Separate WS per sport?
