#!/usr/bin/env bash
# Starts Fileverse inside a GitHub Codespace. Runs automatically every time the codespace starts.
#   bash .devcontainer/start.sh            start (first run downloads or builds the app)
#   bash .devcontainer/start.sh --update   replace the running app with the latest version from GitHub
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="$(echo "${GITHUB_REPOSITORY:-krishshah026/fileverse}" | tr '[:upper:]' '[:lower:]')"
REMOTE_IMAGE="ghcr.io/${REPO%%/*}/fileverse:latest"
NAME=fileverse

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }

say "Waiting for Docker"
for _ in $(seq 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null 2>&1 || { echo "Docker did not start. Rebuild the codespace (Ctrl/Cmd+Shift+P → 'Rebuild Container')."; exit 1; }

get_image() {
  if docker pull "$REMOTE_IMAGE" >/dev/null 2>&1; then IMAGE="$REMOTE_IMAGE"; return; fi
  if [ -n "${GITHUB_TOKEN:-}" ] \
     && echo "$GITHUB_TOKEN" | docker login ghcr.io -u "${GITHUB_USER:-codespace}" --password-stdin >/dev/null 2>&1 \
     && docker pull "$REMOTE_IMAGE" >/dev/null 2>&1; then IMAGE="$REMOTE_IMAGE"; return; fi
  say "Building Fileverse from source (one time only, about 10–15 minutes)"
  docker build -t fileverse:local .
  IMAGE=fileverse:local
}

if [ "${1:-}" = "--update" ]; then
  git pull --ff-only || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker image rm "$REMOTE_IMAGE" fileverse:local >/dev/null 2>&1 || true
fi

if docker container inspect "$NAME" >/dev/null 2>&1; then
  say "Starting Fileverse"
  docker start "$NAME" >/dev/null
else
  say "Getting Fileverse (first start only)"
  get_image
  docker run -d --name "$NAME" --restart unless-stopped -p 8080:8080 \
    -e FILE_TTL_MINUTES=120 \
    -e MAX_UPLOAD_MB=20480 \
    -e UPLOAD_CHUNK_MB=20 \
    -e DISK_RESERVE_MB=2048 \
    -e HEAVY_CONCURRENCY=1 \
    -e LIGHT_CONCURRENCY=2 \
    --ulimit nofile=65536:65536 \
    -v fileverse-data:/data \
    "$IMAGE" >/dev/null
fi

say "Waiting for Fileverse to be ready"
for _ in $(seq 120); do
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
  echo "Fileverse did not start. Last log lines:"; docker logs --tail 50 "$NAME"; exit 1
fi

URL="http://localhost:8080"
[ -n "${CODESPACE_NAME:-}" ] && URL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
printf '\n\033[1;32m✔ Fileverse is running:\033[0m %s\n' "$URL"
echo "  (If it didn't open by itself: Ports tab → port 8080 → globe icon.)"
