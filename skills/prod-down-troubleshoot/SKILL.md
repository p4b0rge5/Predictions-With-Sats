---
name: prod-down-troubleshoot
description: Diagnose why the production server (pwsats.com) is unreachable. Checks services, DNS, Caddy, firewall, and network from outside and inside. Use when user reports "servidor fora do ar".
---

# Production Down Troubleshooting

## Context
- **Prod server**: `root@37.114.37.140` port **24003** (OVH)
- **Access**: Jump SSH via dev server `root@2602:294:0:66d:3:fa3e:5395:3001`
- **Domain**: `pwsats.com`
- **Services**: `pwsats-api` (:3001), `pwsats-web` (:3002), `caddy` (:80,:443)

## Diagnosis Steps

### 1. Check services from inside (jump SSH)
```bash
ssh -i .ssh/id_ed25519 root@2602:294:0:66d:3:fa3e:5395:3001 \
  'ssh -i ~/.ssh/prd_key -p 24003 -o StrictHostKeyChecking=no root@37.114.37.140 \
  "systemctl is-active pwsats-api && systemctl is-active pwsats-web && systemctl is-active caddy"'
```

### 2. Check ports listening
```bash
ssh ... 'ssh ... "ss -tlnp | grep -E \":80|:443|:3001|:3002\""'
```

### 3. Check DNS resolution (from agent VM)
```bash
dig +short pwsats.com A
dig +short pwsats.com AAAA
```
If no output → **domain has no A/AAAA record**. This is the most common cause of "site down".

### 4. Test from inside the server (local curl)
```bash
ssh ... 'ssh ... "curl -s -o /dev/null -w %HTTP_CODE% http://localhost:3001/"'
ssh ... 'ssh ... "curl -s -o /dev/null -w %HTTP_CODE% http://localhost/"'
```
If these work but external doesn't → DNS or firewall issue.

### 5. Test from outside (agent VM → prod IP directly)
```bash
curl -sk --connect-timeout 5 -H "Host: pwsats.com" https://37.114.37.140/ 2>&1 | head -5
```
If this returns `aleph-vm` instead of the app → **OVH firewall is intercepting** traffic on standard ports.

## Common Issues & Fixes

### DNS has no A record
- **Symptom**: `dig pwsats.com A` returns nothing
- **Fix**: Add A record `pwsats.com → 37.114.37.140` at your DNS provider (Cloudflare, Namecheap, etc.)
- **Note**: DNS propagation can take 0-48 hours depending on TTL

### Caddy stopped (e.g. from `caddy stop` or crash)
- **Symptom**: `systemctl is-active caddy` returns `inactive`
- **Fix**: `systemctl start caddy`
- **If port 2019 conflict**: `pkill -9 caddy; sleep 1; systemctl start caddy`

### Caddy config invalid
- **Symptom**: `systemctl start caddy` fails with config error
- **Check**: `caddy validate --config /etc/caddy/Caddyfile`
- **Fix**: Edit `/etc/caddy/Caddyfile` and `systemctl restart caddy`

### OVH firewall intercepting ports 80/443
- **Symptom**: External curl to IP returns `aleph-vm` server header
- **Note**: This is OVH's anti-DDoS or security feature. May need to configure via OVH dashboard.
- **Workaround**: Use non-standard ports or VPN/IPsec

### Service processes crashed
- **Fix**: `systemctl restart pwsats-api && systemctl restart pwsats-web`
- **Check logs**: `journalctl -u pwsats-api --no-pager -n 50`
