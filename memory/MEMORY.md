# MEMORY.md

## Project: Predictions-With-Sats (PWSats)

### Architecture
- **Monorepo** with pnpm workspaces
- **API Server** (`@workspace/api-server`): Express + TypeScript, port 3001
  - Routes mounted at `/api/*` (Express `app.use("/api", router)`)
  - Also mounts `/admin/*` and `/webhook/*`
- **Frontend** (`@workspace/predictions-with-sats-web`): React + Vite, port 3002
  - Vite `base` = `process.env.BASE_PATH ?? "/"` (set to `/app`)
  - Vite dev server proxy: `/api` → `localhost:3001` (passes through headers)
- **Database**: PostgreSQL 16 on localhost:5432

### Deployment (baal-agent VM)

**Critical: Caddy reverse proxy config at `/etc/caddy/conf.d/pwsats.caddy`**

```caddyfile
# Exact /app → redirect to /app/ (without this, /app falls through to baal-agent 401)
redir /app /app/

# API routes — use "handle" (not handle_path) + strip_prefix
handle /app/api/* {
    uri strip_prefix /app        # /app/api/healthz → /api/healthz
    reverse_proxy localhost:3001
}
handle /app/admin/* {
    uri strip_prefix /app
    reverse_proxy localhost:3001
}
handle /app/webhook/* {
    uri strip_prefix /app
    reverse_proxy localhost:3001
}

# Frontend — "handle" passes full URL; Vite base=/app expects /app/ paths
handle /app/* {
    reverse_proxy localhost:3002
}
```

### Gotchas (learned the hard way)

1. **`handle` vs `handle_path`**: `handle_path /app/api/*` strips `/app/api/` before proxying.
   Use `handle /app/api/*` + `uri strip_prefix /app` to control what the upstream receives.

2. **Trailing slash**: `handle /app/*` does NOT match `/app` (no trailing slash).
   → Add `redir /app /app/` at the top.

3. **Vite `base` option**: When `BASE_PATH=/app`, Vite generates all asset URLs with `/app/` prefix.
   The Caddy handler must forward the URL **as-is** (use `handle`, not `handle_path`).

4. **PORT env collision**: Both API and Web default to reading `PORT` from env.
   Start API first (PORT=3001), then Web with explicit PORT=3002.
   `nohup env BASE_PATH=/app PORT=3002 pnpm --filter ... &`

5. **Order matters in Caddy**: Handlers are evaluated top-to-bottom. Specific patterns
   (`/app/api/*`) must come before general ones (`/app/*`).

6. **Polymarket team IDs are integers, not strings**: `asString()` originally only
   handled `typeof value === "string"`, so numeric team IDs from the Gamma API returned
   null, causing ALL teams to be rejected by `pushTeams`. Fixed by also handling
   `typeof value === "number"` in `asString()`.

### Services
- API: `cd Predictions-With-Sats && pnpm --filter @workspace/api-server run start`
- Web: `cd Predictions-With-Sats && env BASE_PATH=/app PORT=3002 pnpm --filter @workspace/predictions-with-sats-web run dev`
- Caddy: `systemctl reload caddy`

### URLs
- Frontend: `https://camera-lens-yellow-smart.2n6.me/app/`
- API: `https://camera-lens-yellow-smart.2n6.me/app/api/...`
- Baal agent: `https://camera-lens-yellow-smart.2n6.me/` (default `/`)

---

## Badge System

Every market now shows a team badge (100% coverage across 452 markets).

**Badge fallback chain** (in `polymarket-sports.ts`):
1. `market.homeBadge` from DB (Polymarket official S3 URL) — 413 markets
2. `leaguePresentation.leagueLogo` — for generic league display
3. `generateTeamBadgeUrl(teamName)` — SVG data URI with colored circle + team initials — 39 markets
4. `null` — never reached for markets with team names

The SVG generator (`generateTeamBadgeUrl`) creates 64x64 circles with consistent team colors (via hash) and 2-3 letter team initials. Works for international leagues (Chinese Super League, J2 League, etc.) without needing external HTTP calls.

The `/api/sports-poly/markets` endpoint serves from 15-minute in-memory cache. Cold start requires Polymarket sync (~200 HTTP calls + enrichment).

---

## Sports Poly: NHL Logo System

Polymarket's Gamma API for `?league=nhl` is unreliable — sometimes returns 36 real team entries with logos, sometimes returns 71 player prop entries (like "Alex DeBrincat"). The Polymarket Gateway always returns player props for NHL.

**Current fix:** Hardcoded `NHL_TEAM_LOGOS` map (36 entries) with stable S3 URLs from `polymarket-upload.s3.us-east-2.amazonaws.com`. The badge enrichment chain is:

1. `homeTeam?.logo` (from metadata)
2. `cachedHomeBadge` (from background scraper)
3. `nhlHomeBadge` (hardcoded NHL logos — **the working fix**)
4. `generateTeamBadgeUrl` (SVG fallback)

The player prop filter (`t.logo || (t.abbreviation has uppercase)`) removes 615 fake entries from the 2000-entry metadata. Thin leagues (< 10 entries) trigger a re-fetch from the Gamma API.

File: `Predictions-With-Sats/artifacts/api-server/src/lib/polymarket-sports.ts`

---

## Polymarket APIs Reference (from GitHub repos research, 2026-05-15)

### Gamma API (CTF/original Polymarket) — our current source
- `GET https://gamma-api.polymarket.com/teams?league={league}&limit=500`
  - Returns teams with: `id, name, league, logo, abbreviation, alias, color, record`
  - Has `color` (hex) but NOT `homeIcon`/`awayIcon`
  - **NHL**: 36 real teams + 4 national teams, all with logos
  - ⚠️ Intermittently returns player props instead of teams (unreliable)
- `GET https://gamma-api.polymarket.com/sports` — 182 sport entries with `image` (league logo)
- `GET https://gamma-api.polymarket.com/events` — events with `series[].image`/`series[].icon`

### Polymarket US API (regulated) — SDK `polymarket-us-typescript`
Base URLs: `gateway.polymarket.us` (public), `api.polymarket.us` (authenticated)

- `GET /v1/sports` — 33 sports with `sport, image` (league logo URL), `series`, `resolution`
  - Every sport has a league image: e.g., `league-images/nhl-new.png`, `league-images/EPL.png`
- `GET /v1/events?active=true` — events with full team objects:
  - Team fields: `id, name, abbreviation, league, record, logo, alias, safeName, homeIcon, awayIcon, colorPrimary`
  - `homeIcon`/`awayIcon` are 320x320 cropped logos for scoreboard display (best quality)
  - ⚠️ US API does NOT include NHL teams (NBA, NFL, MLB, UFC, etc. only)
- `GET /v1/sports/teams/provider` — team lookup (valid provider values TBD, 404s without auth)
- `GET /v1/series` — 51 series entries

### Key S3 URL Patterns (polymarket-upload.s3.us-east-2.amazonaws.com)
- `NHL+Team+Logos/{ABBR}.png` — NHL team logos (32 entries)
- `NBA+Team+Logos/{ABBR}.png` — NBA team logos
- `league-images/{league}.png` — Official league logos (nhl-new.png, nba-new.png, EPL.png)
- `team_logos/soccer/{region}/{region}_{league}_{team}.png` — Soccer team logos
- `us/{sport}/Polymarket_{Team-Name}_{R|L}@320x320.png` — Cropped homeIcon/awayIcon

### Notes
- Official SDK: `npm install polymarket-us` → `client.sports.teams({league:'nba'})` returns `Record<string, SportsTeam>`
- All 68 public Polymarket repos are SDKs/CLOB clients — exchange frontend is private
- NHL teams only exist on Gamma API; US API doesn't have them
