# Version Sync Check

**Description:** Verify that development, git remote (GitHub), and production environments are on the same commit, branch, and working state.

## Context

- **Dev server:** `root@2602:294:0:66d:3:fa3e:5395:3001` via SSH, project at `/opt/baal-agent/workspace/pwsats-local`
- **Production server:** `root@37.114.37.140 -p 24003` — **must be accessed through dev as SSH hop** using `~/.ssh/prd_key` on the dev server, project at `/opt/Predictions-With-Sats`
- **Git remote:** GitHub (`origin`) accessed from dev server

## Why SSH hop?

Direct SSH from this agent VM to production (`37.114.37.140:24003`) fails with `Permission denied (publickey)` even with the correct key. The key `/root/.ssh/prd_key` on the dev server works — likely due to server-side allowlists or source IP restrictions.

**SSH hop pattern:**
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 \
  root@2602:294:0:66d:3:fa3e:5395:3001 \
  "ssh -i /root/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 'command'"
```

## Steps

### 1. Check dev
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@DEV_IP \
  "cd /opt/baal-agent/workspace/pwsats-local && git log --oneline -3 && git rev-parse HEAD && git branch --show-current"
```

### 2. Check git remote (fetch from dev)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@DEV_IP \
  "cd /opt/baal-agent/workspace/pwsats-local && git fetch origin main && git log --oneline -3 origin/main"
```

### 3. Check production (via SSH hop)
```bash
ssh -i /opt/baal-agent/workspace/.ssh/id_ed25519 root@DEV_IP \
  "ssh -i /root/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 'cd /opt/Predictions-With-Sats && git log --oneline -3 && git rev-parse HEAD && git branch --show-current && git status'"
```

### 4. Compare
All three should show the same:
- Full commit SHA (`git rev-parse HEAD`)
- Branch (`main`)
- Working tree state (`nothing to commit, working tree clean`)

If any differ, the environments are out of sync.
