#!/bin/sh
set -eu
export DOCKER_CONFIG="${DOCKER_CONFIG:-/workspace/.cache/docker}"
if [ -n "${HTTPS_PROXY:-}" ] && [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
  NEXUS_BUILD_PROXY_HOST=$(node -e 'process.stdout.write(new URL(process.env.HTTPS_PROXY).hostname)')
  NEXUS_BUILD_PROXY_IP=$(getent ahostsv4 "$NEXUS_BUILD_PROXY_HOST" | awk 'NR==1 {print $1}')
  export NEXUS_BUILD_PROXY_HOST NEXUS_BUILD_PROXY_IP
  exec docker compose -f compose.yaml -f compose.cloud.yaml "$@"
fi
exec docker compose -f compose.yaml "$@"
