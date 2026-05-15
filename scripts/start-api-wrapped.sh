#!/bin/bash
# Source .env and export all variables
set -a
source /tmp/pwsats-env.tmp
set +a
cd /opt/baal-agent/workspace/Predictions-With-Sats/artifacts/api-server
node --enable-source-maps ./dist/index.mjs
