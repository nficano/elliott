#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

SPRUCE_HOST="${SPRUCE_HOST:-spruce}"
REMOTE_DIR="${ELLIOTT_REMOTE_DIR:-/Users/nficano/code/elliott}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

command -v vault >/dev/null
command -v jq >/dev/null
command -v rsync >/dev/null

umask 077
vault kv get -format=json secret/services/oslo \
  | jq -r '.data.data | to_entries[] | "\(.key)=\(.value)"' \
  > "$TEMP_DIR/.env"

RELEASE="$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)"
printf '\nELLIOTT_RELEASE=%s\n' "$RELEASE" >> "$TEMP_DIR/.env"

docker build \
  --label "org.opencontainers.image.revision=$RELEASE" \
  --tag elliott:latest \
  .
docker save elliott:latest | gzip > "$TEMP_DIR/elliott-image.tar.gz"

ssh -o BatchMode=yes "$SPRUCE_HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az \
  --exclude .git \
  --exclude .repos \
  --exclude node_modules \
  --exclude crates/hot-core/target \
  --exclude deploy/.env \
  ./ "$SPRUCE_HOST:$REMOTE_DIR/"
rsync -az "$TEMP_DIR/.env" "$SPRUCE_HOST:$REMOTE_DIR/deploy/.env"
rsync -az \
  "$TEMP_DIR/elliott-image.tar.gz" \
  "$SPRUCE_HOST:/tmp/elliott-image-$RELEASE.tar.gz"

ssh -o BatchMode=yes "$SPRUCE_HOST" "bash -lc '
  set -euo pipefail
  export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
  cd "$REMOTE_DIR/deploy"
  chmod 600 .env
  set -a
  . ./.env
  set +a
  gzip -dc "/tmp/elliott-image-$RELEASE.tar.gz" | docker load
  rm -f "/tmp/elliott-image-$RELEASE.tar.gz"
  docker compose config --quiet
  docker compose up -d --no-build --remove-orphans
  for attempt in \$(seq 1 24); do
    if curl -fsS http://127.0.0.1:18082/healthz >/dev/null; then
      echo "elliott healthy on attempt \$attempt"
      exit 0
    fi
    sleep 5
  done
  docker compose logs --tail=150 elliott
  exit 1
'"
