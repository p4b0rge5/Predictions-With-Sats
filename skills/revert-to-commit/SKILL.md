# Revert to a Specific Commit

## Description
Revert the dev server to a specific git commit, force-push to GitHub, rebuild both api-server and web, and restart the service. Use when you need to undo recent changes and roll back to a known-good state.

## Steps

### 1. Hard reset to target commit on dev server
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'cd /opt/baal-agent/workspace/pwsats-local && git reset --hard <COMMIT> && git log --oneline -5'
```

### 2. Force-push to GitHub (rewrites main branch history)
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'cd /opt/baal-agent/workspace/pwsats-local && git push origin main --force'
```

### 3. Rebuild and restart on dev
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'cd /opt/baal-agent/workspace/pwsats-local && git pull origin main \
    && cd artifacts/api-server && pnpm build \
    && cd ../predictions-with-sats-web && pnpm build \
    && systemctl restart pwsats-api'
```

### 4. Verify service restarted and is running
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'systemctl is-active pwsats-api \
    && journalctl -u pwsats-api --no-pager -n 20'
```

### 5. (Optional) Sync prod
If prod needs to match, deploy via the prod-deploy skill (dev → prod jump SSH).

## Notes
- `git reset --hard` discards uncommitted changes on the target machine
- `git push --force` rewrites remote history — anyone with local clones will need to re-fetch
- Frontend is static (served by Caddy), no separate service restart needed for web-only changes
- Api-server changes require `pnpm build` + `systemctl restart pwsats-api`
