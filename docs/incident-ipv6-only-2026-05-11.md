# Aleph Cloud IPv4 NAT — Custom Domain Not Registered

**Date:** 2026-05-11
**Status:** 🔧 Fix requires action (register domain in Aleph Cloud Console)
**Impact:** Users on IPv4-only networks cannot reach pwsats.com

## Root Cause

The A record for `pwsats.com` (`37.114.37.140`) points to the Aleph CRN, but the **Aleph Custom Domain Service was never configured** for this domain. Without registration, the HAProxy on the CRN returns `404: Invalid message reference` instead of forwarding to our VM.

From [Aleph Cloud docs](https://docs.aleph.cloud/devhub/deploying-and-hosting/custom-domains/instance.html):
> "On IPv4, the instance receives no public address, thus the IP point to the hosting Compute Resource Node... For HTTP, HTTPS (port 80 and 443), requests get automatically redirected to your instance via HAProxy"

This requires:
1. Domain registered in Aleph Cloud Console/CLI
2. DNS **CNAME** record pointing to `instance.public.aleph.sh`
3. DNS **TXT** record at `_control.<domain>` with Ethereum address

## Current State

```
DNS (Njalla):
  pwsats.com. A     37.114.37.140       ← wrong: direct A record
  pwsats.com. AAAA  2a0e:97c0:...       ← correct

Aleph Console:
  pwsats.com NOT registered as custom domain ← missing

Inside VM:
  ens3: 172.16.7.2/24 (private only)
  ens3: 2a0e:97c0:... (public IPv6)
  Caddy: *:80, *:443 (listens on all interfaces)
  curl http://37.114.37.140/ → 404 "aleph-vm/1.12.0"
```

## Fix Required

### 1. Register `pwsats.com` in Aleph Cloud Console
- Settings → Domains → Create Custom Domain
- Enter `pwsats.com`, select this instance

### 2. Change Njalla DNS
- **Remove:** `pwsats.com A 37.114.37.140`
- **Add:** `pwsats.com CNAME instance.public.aleph.sh`
- **Add:** `_control.pwsats.com TXT <ethereum-address>`
- **Keep:** AAAA record as-is

### 3. Verify
```bash
curl -4 https://pwsats.com/  # should return 200/308 from Caddy, not aleph-vm 404
```

## SSH Access (Current Workaround)

SSH currently works on IPv4 port 24003 via direct connection (non-standard port). After custom domain setup, IPv4 SSH can use the standard HAProxy tunnel on port 2222.

## Skill Reference

See `skills/aleph-custom-domain-ipv4/SKILL.md` for the full procedure.
