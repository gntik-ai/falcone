#!/usr/bin/env bash
# Bring up the Falcone test environment (Postgres + Keycloak), wait for health,
# provision the Keycloak admin service account, and apply known service migrations.
# Idempotent: safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
KC=/opt/keycloak/bin/kcadm.sh

echo "==> docker compose up"
docker compose up -d

echo "==> waiting for health"
for i in $(seq 1 60); do
  pg=$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null || true)
  kc=$(docker compose ps keycloak --format '{{.Health}}' 2>/dev/null || true)
  rp=$(docker compose ps redpanda --format '{{.Health}}' 2>/dev/null || true)
  [ "$pg" = "healthy" ] && [ "$kc" = "healthy" ] && [ "$rp" = "healthy" ] && break
  sleep 5
done
[ "${pg:-}" = "healthy" ] && [ "${kc:-}" = "healthy" ] && [ "${rp:-}" = "healthy" ] || { echo "services not healthy (pg=$pg kc=$kc redpanda=$rp)" >&2; exit 1; }

echo "==> provisioning Keycloak admin service account (falcone-admin)"
docker compose exec -T keycloak "$KC" config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin >/dev/null
docker compose exec -T keycloak "$KC" create clients -r master \
  -s clientId=falcone-admin -s enabled=true -s publicClient=false \
  -s serviceAccountsEnabled=true -s secret=falcone-admin-secret >/dev/null 2>&1 \
  && echo "   created client falcone-admin" || echo "   client falcone-admin already exists"
docker compose exec -T keycloak "$KC" add-roles -r master \
  --uusername service-account-falcone-admin --rolename admin >/dev/null
echo "   granted realm 'admin' role to service-account-falcone-admin"

echo "==> applying backup-status migrations to Postgres"
for f in "$ROOT"/services/backup-status/src/db/migrations/*.sql; do
  [ -f "$f" ] || continue
  docker compose exec -T postgres psql -v ON_ERROR_STOP=0 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $(basename "$f")" || echo "   skipped $(basename "$f") (already applied?)"
done

echo
echo "Test environment is UP."
echo "  Keycloak admin console : http://localhost:8081  (admin/admin)"
echo "  Postgres               : postgres://falcone:falcone@localhost:55432/falcone_test"
echo
echo "Point a shell/test at it with:  source tests/env/env.sh"
