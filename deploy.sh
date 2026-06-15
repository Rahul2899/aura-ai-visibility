#!/usr/bin/env bash
# Aura AI — deploy/update on the EC2 box. Run this ON the server (it does not SSH
# for you). Idempotent: pulls latest master, rebuilds, migrates, smoke-tests.
#
#   ssh ubuntu@<EC2_IP>
#   cd ~/aura-ai-visibility && ./deploy.sh
#
# Prereqs on the box (one-time): docker + docker compose installed, repo cloned,
# and a .env present with rotated secrets + SITE_ADDRESS set (see DEPLOY.md).
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Checking .env exists with required keys"
test -f .env || { echo "ERROR: .env missing. See DEPLOY.md."; exit 1; }
grep -q '^SITE_ADDRESS=' .env || echo "WARN: SITE_ADDRESS not set in .env — Caddy will serve plain HTTP on :80 (no TLS)."

echo "==> Pulling latest master"
git fetch origin
git checkout master
git pull origin master

echo "==> Building and starting all services"
# The app applies idempotent schema migrations (the _MIGRATIONS list in
# src/api/main.py: ADD COLUMN IF NOT EXISTS, etc.) automatically on startup,
# so no separate migrate step is needed.
docker compose up -d --build

# Health-check the app INSIDE its container, not via the host. Caddy enforces HTTPS
# (308 -> https) and the app's 8000 port isn't published to the host, so a host-side
# "http://localhost/api/..." curl just sees the redirect, not the API. Inside the
# container the app serves at :8000 with no Caddy/TLS in the way (routes are mounted at
# root — Caddy strips the /api prefix). The slim Python image has no curl, so we use
# urllib (always present) and just check for an HTTP 200.
app_status() {
  docker compose exec -T app python -c \
    "import urllib.request,sys
try:
    r=urllib.request.urlopen('http://localhost:8000/brands?session_id=example',timeout=5)
    print(r.status)
except Exception:
    print(0)" 2>/dev/null
}

echo "==> Waiting for the API to come up"
for i in $(seq 1 30); do
  if [ "$(app_status)" = "200" ]; then
    echo "    API is up."
    break
  fi
  sleep 2
done

echo "==> Smoke test"
code=$(app_status)
if [ "$code" = "200" ]; then
  echo "    OK: /brands returned 200"
else
  echo "    FAIL: /brands returned $code — check 'docker compose logs app'"
  exit 1
fi

echo "==> Done. Verify in a browser at your SITE_ADDRESS."
echo "    Container status:"
docker compose ps
