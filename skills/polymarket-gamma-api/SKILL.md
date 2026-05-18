---
name: polymarket-gamma-api-query
description: Query the Polymarket Gamma API (gamma-api.polymarket.com) for sports markets. Requires specific headers (User-Agent, Referer, Origin) or returns 403. Useful for checking what's live on Polymarket directly, not via our DB.
---

# Query Polymarket Gamma API

## Key Details

- **Base URL**: `https://gamma-api.polymarket.com`
- **Requires headers** or returns 403:
  ```python
  headers = {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      "Referer": "https://polymarket.com",
      "Origin": "https://polymarket.com",
  }
  ```
- **Sports tag ID**: `1` (or resolve via `/tags/slug/sports`)
- **Page limit**: 100 per page

## Endpoints

### Get markets
```
/markets?limit=100&offset=0&active=true&closed=false&order=end_date&ascending=true&tag_id=1
```

### Get closed markets
```
/markets?limit=100&offset=0&closed=true&order=closed_time&ascending=false&tag_id=1
```

### Get tag by slug
```
/tags/slug/sports
/tags/slug/weather
```

## Python Template

```python
import json, urllib.request, time

base = "https://gamma-api.polymarket.com"
hdrs = {"Accept": "application/json", "User-Agent": "Mozilla/5.0",
        "Referer": "https://polymarket.com", "Origin": "https://polymarket.com"}

def fetch(url):
    req = urllib.request.Request(url)
    for k, v in hdrs.items(): req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())

markets = []
for p in range(30):
    batch = fetch(f"{base}/markets?limit=100&offset={p*100}&active=true&tag_id=1")
    if not batch: break
    markets.extend(batch)
    if len(batch) < 100: break
    time.sleep(0.3)
```

## Important Notes

- **No `gameStartTime` for soccer markets** — football uses `startDate` (season start) and `endDate` (season end). Match-day specific markets are rare on Polymarket for soccer.
- Soccer markets are mostly **seasonal** (who wins the league, top scorer, relegation, World Cup)
- Use `tag_id=1` for sports, resolve weather via `/tags/slug/weather`
- Rate limit: ~0.3s between pages to avoid throttling
- The `metadata.events[].startDate` is the event/season start, NOT the match date
- Soccer filter: check question/title for league keywords AND exclude non-soccer (nfl, nba, etc.)

## Soccer Filter Pattern

```python
soccer_kw = ['football', 'soccer', 'la liga', 'premier league', 'bundesliga',
             'serie a', 'ligue 1', 'eredivisie', 'liga mx', 'brasileirao',
             'mls', 'j1 league', 'j2 league', 'champions league', 'world cup']
non_soccer = ['nfl', 'nba', 'nhl', 'mlb', 'basketball', 'baseball',
              'hockey', 'tennis', 'golf', 'mma', 'ufc', 'f1', 'cricket']

def is_soccer(market):
    q = str(market.get('question', '') or '').lower()
    meta = market.get('metadata') or {}
    if isinstance(meta, dict):
        q += ' ' + str(meta.get('sport', '') or '').lower()
    return any(k in q for k in soccer_kw) and not any(k in q for k in non_soccer)
```
