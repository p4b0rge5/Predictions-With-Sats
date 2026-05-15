#!/usr/bin/env bash
# /opt/baal-agent/workspace/Predictions-With-Sats/scripts/dev-start.sh
# Start the PWSats dev environment (API + Web) with Caddy reverse proxy.
# Usage: bash scripts/dev-start.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ------------------------------------------------------------------
# 1. Kill any previous instances
# ------------------------------------------------------------------
echo "⏹  Killing old processes on ports 3001 and 3002..."
for port in 3001 3002; do
    pid=$(ss -tlnp | grep ":${port}" | grep -oP 'pid=\K[0-9]+' || true)
    if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
    fi
done
sleep 1

# ------------------------------------------------------------------
# 2. Load .env into environment
# ------------------------------------------------------------------
echo "📄 Loading .env..."
export $(grep -E '^[A-Z_]+=' .env | sed 's/="*/"/;s/"*$//;s/=/"=/' | while IFS= read -r line; do
    key="${line%%=*}"
    val="${line#*=}"
    # Remove surrounding quotes if present
    val="${val#\"}"
    val="${val%\"}"
    echo "export ${key}=\"${val}\""
done)

# Override for web server
export PORT_WEB=3002
export BASE_PATH=/app

# ------------------------------------------------------------------
# 3. Start API server (port 3001)
# ------------------------------------------------------------------
echo "🚀 Starting API server on port ${PORT:-3001}..."
nohup pnpm --filter @workspace/api-server run start \
    > /tmp/pwsats-api.log 2>&1 &
echo "   API PID: $!"

# ------------------------------------------------------------------
# 4. Start Web dev server (port 3002)
# ------------------------------------------------------------------
echo "🌐 Starting Web dev server on port ${PORT_WEB:-3002}..."
nohup env BASE_PATH=/app PORT=3002 \
    pnpm --filter @workspace/predictions-with-sats-web run dev \
    > /tmp/pwsats-web.log 2>&1 &
echo "   Web PID: $!"

# ------------------------------------------------------------------
# 5. Wait for both to be listening
# ------------------------------------------------------------------
echo "⏳ Waiting for services..."
for i in $(seq 1 20); do
    api_up=$(ss -tlnp | grep -c ':3001' || true)
    web_up=$(ss -tlnp | grep -c ':3002' || true)
    if [[ "$api_up" -ge 1 && "$web_up" -ge 1 ]]; then
        break
    fi
    sleep 1
done

# ------------------------------------------------------------------
# 6. Install Caddy config if not already correct
# ------------------------------------------------------------------
echo "🔧 Configuring Caddy..."
cat > /etc/caddy/conf.d/pwsats.caddy << 'EOF'
# Predictions-With-Sats — access at /app

# Exact /app → redirect to /app/ (prevents fallback to baal-agent 401)
redir /app /app/

# API routes — "handle" preserves full path, strip_prefix removes /app
handle /app/api/* {
    uri strip_prefix /app
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

# Frontend — Vite dev server with base=/app (passes URL as-is)
handle /app/* {
    reverse_proxy localhost:3002
}
EOF

systemctl reload caddy
sleep 1

if ! systemctl is-active --quiet caddy; then
    echo "❌ Caddy failed to reload! Check: journalctl -u caddy --no-pager -n 20"
    exit 1
fi

# ------------------------------------------------------------------
# 7. Health checks
# ------------------------------------------------------------------
echo ""
echo "========================================="
echo "  Predictions-With-Sats — Dev Status"
echo "========================================="
echo ""

api_status=$(curl -sk -o /dev/null -w '%{http_code}' https://camera-lens-yellow-smart.2n6.me/app/api/healthz)
web_status=$(curl -sk -o /dev/null -w '%{http_code}' https://camera-lens-yellow-smart.2n6.me/app/)
redirect_status=$(curl -sk -o /dev/null -w '%{http_code}' https://camera-lens-yellow-smart.2n6.me/app)

if [[ "$api_status" == "200" ]]; then echo "🟢 API    : port 3001 OK"; else echo "🔴 API    : port 3001 FAILED (HTTP $api_status)"; fi
if [[ "$web_status" == "200" ]]; then echo "🟢 Frontend : port 3002 OK"; else echo "🔴 Frontend : port 3002 FAILED (HTTP $web_status)"; fi
if [[ "$redirect_status" == "302" ]]; then echo "🟢 Redirect : /app → /app/ OK"; else echo "🔴 Redirect : /app → /app/ FAILED (HTTP $redirect_status)"; fi

echo ""
echo "🌐 Frontend: https://camera-lens-yellow-smart.2n6.me/app/"
echo "🔌 API:     https://camera-lens-yellow-smart.2n6.me/app/api/healthz"
echo "========================================="
