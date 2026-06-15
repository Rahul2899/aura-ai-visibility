#!/usr/bin/env bash
#
# Populate the 4 demo (example) brands with REAL audit data. Run this ONCE after a
# fresh deploy — db_seed.py only inserts the brand rows, not their scores.
#
# How it works: example brands are intentionally read-only (the audit API rejects them),
# so this temporarily flips them to a normal session, audits each as admin (no rate
# limit), then flips them back to "example". Safe to re-run — it only (re)audits the
# four seeded brand ids and always restores the example flag.
#
# Usage (on the server, from the repo root):
#   ADMIN_KEY=... ./seed_audit.sh
#   # or it reads ADMIN_KEY / POSTGRES_* from .env automatically
#
set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────────
DB_SERVICE="${DB_SERVICE:-db}"                    # compose service name for postgres
BRAND_IDS=(1004 1005 1006 1007)                   # the seeded demo brand ids

# Load secrets from .env if present (so you can just run ./seed_audit.sh)
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Pick the API base. In production Caddy enforces HTTPS (a host-side http://localhost
# call just 308-redirects and https://localhost fails the cert check), so default to
# the real domain from SITE_ADDRESS. Local dev (no SITE_ADDRESS / plain ":80") keeps
# http://localhost. An explicit API_BASE always wins.
if [ -n "${API_BASE:-}" ]; then
  API="$API_BASE"
elif [ -n "${SITE_ADDRESS:-}" ] && [ "${SITE_ADDRESS}" != ":80" ]; then
  API="https://${SITE_ADDRESS#https://}/api"     # strip any scheme the user added
else
  API="http://localhost/api"
fi
ADMIN_KEY="${ADMIN_KEY:?ADMIN_KEY must be set (in .env or the environment)}"
PGUSER="${POSTGRES_USER:-peec}"
PGPASS="${POSTGRES_PASSWORD:-peec}"
PGDB="${POSTGRES_DB:-peec}"

psql_exec() {
  docker compose exec -T -e PGPASSWORD="$PGPASS" "$DB_SERVICE" \
    psql -h 127.0.0.1 -U "$PGUSER" -d "$PGDB" -tAc "$1"
}

echo "▸ Confirming the 4 demo brands exist…"
COUNT=$(psql_exec "SELECT count(*) FROM brands WHERE id IN (1004,1005,1006,1007);")
if [ "$COUNT" != "4" ]; then
  echo "✗ Expected 4 seeded demo brands (ids 1004-1007), found $COUNT. Run the app once so db_seed seeds them, then retry." >&2
  exit 1
fi

# Always restore the example flag on exit, even if an audit fails midway. Idempotent:
# safe to call explicitly at the end AND via the trap.
_restored=0
restore_example() {
  [ "$_restored" = "1" ] && return 0
  _restored=1
  echo "▸ Restoring read-only 'example' flag on the demo brands…"
  psql_exec "UPDATE brands SET session_id='example' WHERE id IN (1004,1005,1006,1007);" >/dev/null
}
trap restore_example EXIT

echo "▸ Temporarily un-locking the demo brands so they can be audited…"
psql_exec "UPDATE brands SET session_id='seed-temp' WHERE id IN (1004,1005,1006,1007);" >/dev/null

for ID in "${BRAND_IDS[@]}"; do
  NAME=$(psql_exec "SELECT name FROM brands WHERE id=$ID;")
  echo "▸ Auditing ${NAME} (#${ID})…"
  RESP=$(curl -s -X POST "${API}/audit/brands/${ID}?session_id=admin" \
    -H "Content-Type: application/json" -H "X-Admin-Key: ${ADMIN_KEY}" \
    -d '{"custom_questions":[]}')
  JOB=$(printf '%s' "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null || true)
  if [ -z "$JOB" ]; then
    echo "  ✗ Could not start audit: $RESP" >&2
    continue
  fi
  # Poll until the job finishes (audits take ~30-90s).
  for _ in $(seq 1 40); do
    STATUS=$(curl -s "${API}/audit/${JOB}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
    case "$STATUS" in
      completed) echo "  ✓ done"; break;;
      failed|unconfirmed) echo "  ✗ $STATUS: $(curl -s "${API}/audit/${JOB}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error',''))" 2>/dev/null)"; break;;
      *) sleep 5;;
    esac
  done
done

# Restore the read-only flag NOW (before the summary) so the anon query below — which
# only sees example brands — reports the populated scores. The EXIT trap is a no-op
# after this thanks to the idempotency guard.
restore_example

echo "▸ Clearing rate-limit rows used during seeding…"
psql_exec "DELETE FROM audit_limits;" >/dev/null

echo ""
echo "▸ Final demo-brand scores:"
curl -s "${API}/brands/compare?session_id=anon" | python3 -c "
import sys,json
for b in sorted(json.load(sys.stdin), key=lambda x: x['id']):
    pct = b.get('visibility_pct')
    print(f\"   {b['name']:<8} {str(round(pct,1))+'%' if pct is not None else 'NO DATA':>8}  [{b.get('industry')}]\")
"
echo "✓ Seed audit complete."
