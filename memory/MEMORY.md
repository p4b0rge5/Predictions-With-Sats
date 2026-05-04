
## CRITICAL: Git Commit After Every Code Change

**Rule:** After finishing ANY code changes to the Predictions-With-Sats project, immediately run:
```
cd /opt/baal-agent/workspace/Predictions-With-Sats && git add -A && git commit -m "descriptive message"
```

The post-commit hook at `.git/hooks/post-commit` automatically:
1. Dumps PostgreSQL database to `db/dump.sql`
2. Amends the dump into the commit
3. Force-pushes to `origin main`

**Never** report changes as "done" without committing. The hook does the push — I just need to trigger the commit.

## PWSats Deployment Fixes (2026-05-04)

### Root Cause: Vite Preview SPA Routing with BASE_PATH
- The Vite preview server with `base: "/pwsats"` expects requests WITH the `/pwsats` prefix
- Do NOT use `uri strip_prefix /pwsats` for the web frontend handler
- The Caddy web handler must pass the full path through (no strip):
  ```
  handle /pwsats/* {
      reverse_proxy localhost:3002
  }
  handle /pwsats {
      reverse_proxy localhost:3002
  }
  ```
- The API handler still strips the prefix (correct):
  ```
  handle /pwsats/api/* {
      uri strip_prefix /pwsats
      reverse_proxy localhost:3001
  }
  ```
- Build must be done with `BASE_PATH=/pwsats` to get correct asset paths in HTML
- The systemd service `pwsats-web` includes `Environment=BASE_PATH=/pwsats`

### Key Finding
- Vite preview server with `base: "/pwsats"` serves index.html at `/pwsats/` (200)
- Without prefix, `/` redirects 302 to `/pwsats` (built-in Vite behavior)
- Caddy `handle_path` with `strip_prefix` was breaking this because it sent `/` to Vite instead of `/pwsats/`
