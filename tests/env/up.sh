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

echo "==> waiting for backing-service health (postgres, keycloak, redpanda)"
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

echo "==> applying scheduling-engine migrations to Postgres"
# pgcrypto provides gen_random_uuid() used by the scheduling tables' defaults.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null 2>&1 || true
for f in "$ROOT"/services/scheduling-engine/migrations/*.sql; do
  [ -f "$f" ] || continue
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $(basename "$f")" || echo "   skipped $(basename "$f") (already applied?)"
done

# ---- HTTP request-chain slice (scheduling only) ----------------------------
# Concrete tenant/workspace the slice user is bound to (mirrors env.sh).
E2E_TENANT_ID="${E2E_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
E2E_WORKSPACE_ID="${E2E_WORKSPACE_ID:-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}"

echo "==> provisioning Keycloak realm falcone-e2e (ROPC client + user + claim mappers)"
E2E_TENANT_ID="$E2E_TENANT_ID" E2E_WORKSPACE_ID="$E2E_WORKSPACE_ID" bash ./keycloak-e2e-provision.sh

echo "==> waiting for slice health (action-runner, apisix)"
for i in $(seq 1 40); do
  ar=$(docker compose ps action-runner --format '{{.Health}}' 2>/dev/null || true)
  ax=$(docker compose ps apisix --format '{{.Health}}' 2>/dev/null || true)
  [ "$ar" = "healthy" ] && [ "$ax" = "healthy" ] && break
  sleep 3
done
[ "${ar:-}" = "healthy" ] && [ "${ax:-}" = "healthy" ] \
  || { echo "slice services not healthy (action-runner=$ar apisix=$ax)" >&2; exit 1; }
echo "   action-runner + apisix healthy"

echo
echo "Test environment is UP."
echo "  Keycloak admin console : http://localhost:8081  (admin/admin)"
echo "  Postgres               : postgres://falcone:falcone@localhost:55432/falcone_test"
echo "  API gateway (APISIX)   : http://localhost:9080  (route /v1/scheduling/*)"
echo "  action-runner shim     : http://localhost:8090  (/healthz, bypasses gateway)"
echo "  Keycloak realm (slice) : falcone-e2e  client=falcone-e2e-client user=e2e-user/e2e-password"
echo
echo "Point a shell/test at it with:  source tests/env/env.sh"
echo "Run the HTTP-slice smoke with:  bash tests/env/e2e-smoke/run.sh"
