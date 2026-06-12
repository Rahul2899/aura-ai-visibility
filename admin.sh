#!/usr/bin/env bash
#
# Admin helper for managing brands. Reads ADMIN_KEY / POSTGRES_* from .env.
#
#   ./admin.sh list                 # show every brand the admin can see
#   ./admin.sh delete <id>          # delete one brand by id (demos are protected)
#   ./admin.sh clean                # delete ALL non-demo brands (keeps ids 1004-1007)
#   ./admin.sh url                  # print the admin-login URL for the browser
#
set -euo pipefail

API="${API_BASE:-http://localhost/api}"
SITE="${SITE_BASE:-http://localhost}"
DB_SERVICE="${DB_SERVICE:-db}"
if [ -f .env ]; then set -a; . ./.env; set +a; fi
ADMIN_KEY="${ADMIN_KEY:?ADMIN_KEY must be set (in .env or the environment)}"
PGUSER="${POSTGRES_USER:-peec}"; PGPASS="${POSTGRES_PASSWORD:-peec}"; PGDB="${POSTGRES_DB:-peec}"

psql_exec() {
  docker compose exec -T -e PGPASSWORD="$PGPASS" "$DB_SERVICE" \
    psql -h 127.0.0.1 -U "$PGUSER" -d "$PGDB" -tAc "$1"
}

case "${1:-}" in
  list)
    echo "All brands (id · name · session · #audits):"
    psql_exec "
      SELECT b.id || '  ·  ' || b.name || '  ·  ' || b.session_id || '  ·  ' ||
             (SELECT count(*) FROM insights WHERE brand_id=b.id) || ' audits' ||
             CASE WHEN b.id BETWEEN 1004 AND 1007 THEN '   [DEMO — protected]' ELSE '' END
      FROM brands b ORDER BY b.id;"
    ;;

  delete)
    ID="${2:?usage: ./admin.sh delete <id>}"
    if [ "$ID" -ge 1004 ] && [ "$ID" -le 1007 ]; then
      echo "✗ Brand $ID is a protected demo brand. Refusing to delete." >&2; exit 1
    fi
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
      "${API}/brands/${ID}?session_id=admin" -H "X-Admin-Key: ${ADMIN_KEY}")
    [ "$CODE" = "204" ] && echo "✓ Deleted brand $ID" || echo "✗ Delete failed (HTTP $CODE)"
    ;;

  clean)
    N=$(psql_exec "SELECT count(*) FROM brands WHERE id NOT BETWEEN 1004 AND 1007;")
    if [ "$N" = "0" ]; then echo "Nothing to clean — only the 4 demo brands exist."; exit 0; fi
    echo "Deleting $N non-demo brand(s), keeping the demos (1004-1007)…"
    psql_exec "
      BEGIN;
      DELETE FROM mentions WHERE run_id IN (SELECT r.id FROM runs r JOIN prompts p ON r.prompt_id=p.id WHERE p.brand_id NOT BETWEEN 1004 AND 1007);
      DELETE FROM runs WHERE prompt_id IN (SELECT p.id FROM prompts p WHERE p.brand_id NOT BETWEEN 1004 AND 1007);
      DELETE FROM prompts WHERE brand_id NOT BETWEEN 1004 AND 1007;
      DELETE FROM probe_performance WHERE brand_id NOT BETWEEN 1004 AND 1007;
      DELETE FROM insights WHERE brand_id NOT BETWEEN 1004 AND 1007;
      DELETE FROM brands WHERE id NOT BETWEEN 1004 AND 1007;
      DELETE FROM audit_limits;
      COMMIT;" >/dev/null
    echo "✓ Cleaned. Remaining brands:"
    psql_exec "SELECT '  ' || id || '  ' || name FROM brands ORDER BY id;"
    ;;

  url)
    echo "Open this in your browser to enter admin mode:"
    echo "  ${SITE}/?admin=${ADMIN_KEY}"
    echo "(Exit admin by clicking the ADMIN badge top-right.)"
    ;;

  *)
    echo "Usage: ./admin.sh {list|delete <id>|clean|url}"; exit 1;;
esac
