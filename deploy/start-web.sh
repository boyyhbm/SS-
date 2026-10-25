#!/bin/sh
set -eu
node scripts/production-config.mjs web
mkdir -p "$NEXUS_UPLOAD_DIR"
test -w "$NEXUS_UPLOAD_DIR"
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
