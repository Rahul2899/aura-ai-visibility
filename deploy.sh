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
docker compose up -d --build

echo "==> Waiting for the API to come up"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost/api/brands?session_id=example"; then
    echo "    API is up."
    break
  fi
  sleep 2
done

echo "==> Smoke test"
code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/brands?session_id=example")
if [ "$code" = "200" ]; then
  echo "    OK: /api/brands returned 200"
else
  echo "    FAIL: /api/brands returned $code — check 'docker compose logs app'"
  exit 1
fi

echo "==> Done. Verify in a browser at your SITE_ADDRESS."
echo "    Container status:"
docker compose ps
