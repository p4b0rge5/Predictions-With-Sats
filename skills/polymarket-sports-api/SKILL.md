---
name: polymarket-sports-api
description: Reference for Polymarket sports data APIs including the real-time Sports WebSocket (scores, periods, status), REST endpoints for events/markets, and team metadata.
---

# Polymarket Sports APIs

## WebSocket (Real-time Scores)

```
wss://sports-api.polymarket.com/ws
```

No auth. No subscription. Connect and receive all active games.

Server pings every 5s with "ping" — respond "pong" within 10s.

**Message:**
```json
{"gameId":10077970,"leagueAbbreviation":"mlb","homeTeam":"WSH","awayTeam":"BAL","score":"6-3","period":"Mid 8th","status":"InProgress","live":true,"ended":false}
```

Emitted on: game start, score change, period change, game end, possession change (NFL/CFB).

## REST API

Base: `https://gamma-api.polymarket.com`

| Endpoint | Purpose |
|----------|---------|
| `GET /sports` | All sports metadata (180+) |
| `GET /teams` | All teams (id, name, league, record, logo, abbreviation) |
| `GET /events?limit=50` | Events with markets |
| `GET /series/{id}` | Series events |

**REST does NOT include live scores** — use WebSocket for that.

## Period Values

1H/2H (soccer/rugby), Q1-Q4 (NFL/NBA), HT, FT, FT OT, End 7-9 (MLB), 1/3 (esports Bo3)
