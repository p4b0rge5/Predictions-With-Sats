---
name: dev-db-query
description: Query the PostgreSQL database on the dev server via SSH heredoc. Use for market stats, debugging data issues, or any ad-hoc SQL. Handles the SSH MOTD noise in stderr.
---

# Query Dev Server PostgreSQL

## Connection

- **Host**: `root@2602:294:0:66d:3:fa3e:5395:3001`
- **SSH key**: `/opt/baal-agent/workspace/.ssh/id_ed25519`
- **DB**: `postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev`

## SSH Heredoc Pattern

Use heredocs to avoid nested quote escaping:

```bash
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=5 \
    -o ServerAliveInterval=3 -o BatchMode=yes \
    root@2602:294:0:66d:3:fa3e:5395:3001 << 'SSHEOF'
psql -t postgresql://pwsats:p4borge55@localhost:5432/pwsats_dev << 'SQL'
SELECT count(*)::text FROM sport_poly_markets WHERE sport = 'Soccer';
SQL
SSHEOF
```

Key flags:
- `-t` on psql → tuples-only (no column headers, cleaner output)
- Use `::text` cast for numbers to avoid alignment issues
- `MOTD` noise goes to stderr, SQL output to stdout

## Prod DB Query

Same pattern, jump through dev to prod:

```bash
ssh -i ~/.ssh/id_ed25519 -o ConnectTimeout=5 root@2602:294:0:66d:3:fa3e:5395:3001 \
  "ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 \
  'psql -t postgresql://pwsats:p4borge55@localhost:5432/pwsats_db -c \"QUERY_HERE\"' 2>&1"
```

## Common Queries

### Markets by date + sport
```sql
SELECT league, count(*)::text
FROM sport_poly_markets
WHERE starts_at::text LIKE '2026-05-17%'
AND sport = 'Soccer'
GROUP BY league ORDER BY count(*) DESC;
```

### Markets with scores
```sql
SELECT count(*)::text
FROM sport_poly_markets
WHERE home_score IS NOT NULL OR away_score IS NOT NULL;
```

### Open vs settled
```sql
SELECT status, count(*)::text
FROM sport_poly_markets GROUP BY status;
```
