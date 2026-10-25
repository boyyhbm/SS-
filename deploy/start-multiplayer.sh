#!/bin/sh
set -eu
node scripts/production-config.mjs multiplayer
exec node --import tsx server/index.ts
