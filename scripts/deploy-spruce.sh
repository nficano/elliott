#!/usr/bin/env bash
# Deploy Elliott to the spruce host: render secret/services/oslo from Vault
# into deploy/.env, build the image locally, rsync it over, compose up, and
# poll /healthz. Runs manually, or from the ci.yml `deploy` job on a
# self-hosted runner.
#
# Requirements (local machine OR self-hosted CI runner):
#   - CLIs: vault, jq, rsync, docker, ssh, git
#   - Vault auth: an ambient VAULT_TOKEN (manual: `vault login`; CI: the
#     workflow logs in via AppRole from VAULT_ROLE_ID/VAULT_SECRET_ID secrets)
#   - SSH: the `spruce` host alias (override with SPRUCE_HOST) reachable with
#     key-based, BatchMode auth, plus a known_hosts entry for it
#   - The runner must be on the LAN — Vault (172.16.x) and spruce are private.
#
# For the self-hosted CI runner, register it with the `spruce-deploy` label:
#   ./config.sh --url https://github.com/nficano/elliott --labels spruce-deploy
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
docker build --file companions/dspy/Dockerfile \
  --tag elliott/evaluator-dspy:local .
docker build --file companions/darwinian/Dockerfile \
  --tag elliott/evaluator-darwinian:local .
docker build --file companions/benchmarks/Dockerfile \
  --tag elliott/evaluator-agent-benchmarks:local .
docker build --file deploy/placement/model-proxy/Dockerfile \
  --tag elliott/model-proxy:local .
docker build --file deploy/placement/canary/Dockerfile \
  --tag elliott/evolution-canary:local .
docker build --file deploy/placement/loopback-bridge/Dockerfile \
  --tag elliott/loopback-bridge:local .
docker save \
  elliott:latest \
  elliott/evaluator-dspy:local \
  elliott/evaluator-darwinian:local \
  elliott/evaluator-agent-benchmarks:local \
  elliott/model-proxy:local \
  elliott/evolution-canary:local \
  elliott/loopback-bridge:local \
  | gzip > "$TEMP_DIR/elliott-image.tar.gz"

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

# Announce the release in Slack #feed. Reaching this line means the ssh block
# above exited 0, i.e. the new runtime is healthy. Best-effort: a Slack hiccup
# must never fail an already-successful deploy, so everything here is guarded.
announce_release() {
  local token channel health skills tools subject text
  token="$(sed -n 's/^slack_bot_token=//p' "$TEMP_DIR/.env")"
  [ -n "$token" ] || { echo "no slack_bot_token; skipping announce"; return 0; }
  channel="${FEED_CHANNEL:-C0BJU9LNNPK}"
  health="$(ssh -o BatchMode=yes "$SPRUCE_HOST" \
    'curl -fsS http://127.0.0.1:18082/healthz' 2>/dev/null || echo '{}')"
  skills="$(printf '%s' "$health" | jq -r '.skills // "?"')"
  tools="$(printf '%s' "$health" | jq -r '.tools // "?"')"
  subject="$(git log -1 --pretty=%s 2>/dev/null || echo "")"
  text=":circle-upload: *Elliott deployed* — \`$RELEASE\`"$'\n'"$subject"$'\n'"$skills skills · $tools tools · healthy on spruce"
  curl -sS -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $token" \
    -H "Content-type: application/json; charset=utf-8" \
    --data "$(jq -n --arg c "$channel" --arg t "$text" \
      '{channel: $c, text: $t, unfurl_links: false}')" \
    | jq -r 'if .ok then "announced release in #feed"
             else "slack announce failed: \(.error)" end'
}
announce_release || true
