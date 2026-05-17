#!/bin/bash
cd /opt/baal-agent/workspace/pwsats-local/artifacts/api-server
source /opt/baal-agent/workspace/pwsats-local/.env
export NODE_ENV=production
node --enable-source-maps ./dist/index.mjs
