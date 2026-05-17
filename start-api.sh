#!/usr/bin/env bash
set -a
source "$PWD/.env"
set +a
export NODE_ENV=production
cd "$PWD/artifacts/api-server"
node --enable-source-maps ./dist/index.mjs
