#!/usr/bin/env bash
# Bring up the Falcone test environment (Postgres + Keycloak + Redpanda + MongoDB
# + MinIO + Vault), wait for health, provision the Keycloak admin service account,
# apply known service migrations, initiate the Mongo replica set, create the MinIO
# bucket, and enable the Vault file audit device.
# Idempotent: safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
KC=/opt/keycloak/bin/kcadm.sh

# Host-mounted Vault audit dir must exist + be writable before the container
# (which writes the file audit log) starts.
mkdir -p ./vault/audit
chmod 777 ./vault/audit 2>/dev/null || true

echo "==> docker compose up"
# --build so the action-runner shim image always reflects the current
# tests/env/action-runner/ source (routes.mjs/server.mjs). Without it, compose
# reuses a stale cached image and new routes silently 404.
docker compose up -d --build

echo "==> waiting for backing-service health (postgres, keycloak, redpanda)"
for i in $(seq 1 60); do
  pg=$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null || true)
  kc=$(docker compose ps keycloak --format '{{.Health}}' 2>/dev/null || true)
  rp=$(docker compose ps redpanda --format '{{.Health}}' 2>/dev/null || true)
  mo=$(docker compose ps mongodb --format '{{.Health}}' 2>/dev/null || true)
  mi=$(docker compose ps minio --format '{{.Health}}' 2>/dev/null || true)
  va=$(docker compose ps vault --format '{{.Health}}' 2>/dev/null || true)
  [ "$pg" = "healthy" ] && [ "$kc" = "healthy" ] && [ "$rp" = "healthy" ] \
    && [ "$mo" = "healthy" ] && [ "$mi" = "healthy" ] && [ "$va" = "healthy" ] && break
  sleep 5
done
[ "${pg:-}" = "healthy" ] && [ "${kc:-}" = "healthy" ] && [ "${rp:-}" = "healthy" ] \
  && [ "${mo:-}" = "healthy" ] && [ "${mi:-}" = "healthy" ] && [ "${va:-}" = "healthy" ] \
  || { echo "services not healthy (pg=$pg kc=$kc redpanda=$rp mongodb=$mo minio=$mi vault=$va)" >&2; exit 1; }

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

echo "==> initiating MongoDB replica set (rs0)"
# Idempotent: rs.initiate() only runs if the set is not already configured.
docker compose exec -T mongodb mongosh --quiet --eval \
  "try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0', members:[{_id:0, host:'mongodb:27017'}]}) }" >/dev/null
# Wait until the node is PRIMARY (change streams need a writable primary).
for i in $(seq 1 30); do
  state=$(docker compose exec -T mongodb mongosh --quiet --eval \
    "try { rs.status().myState } catch (e) { -1 }" 2>/dev/null | tr -d '[:space:]')
  [ "$state" = "1" ] && break
  sleep 2
done
[ "${state:-}" = "1" ] && echo "   replica set rs0 is PRIMARY" \
  || { echo "   mongodb did not reach PRIMARY (myState=$state)" >&2; exit 1; }

echo "==> creating MinIO bucket (falcone-test)"
# Run mc inside the minio container (it ships the mc client).
docker compose exec -T minio sh -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin >/dev/null 2>&1 && mc mb --ignore-existing local/falcone-test >/dev/null" \
  && echo "   bucket falcone-test ready" \
  || { echo "   failed to create MinIO bucket" >&2; exit 1; }

echo "==> enabling Vault file audit device"
# Idempotent: enabling an already-enabled device returns an error we ignore.
# mode=0644 so the host test process (secret-audit-handler) can read the log;
# the dev container runs as a non-host uid and the default 0600 would lock it out.
docker compose exec -T -e VAULT_ADDR=http://localhost:8200 -e VAULT_TOKEN=root vault \
  vault audit enable file file_path=/vault/audit/vault-audit.log mode=0644 >/dev/null 2>&1 \
  && echo "   file audit device enabled" || echo "   file audit device already enabled"
# Generate at least one audit entry so the host-visible log file exists + is non-empty.
docker compose exec -T -e VAULT_ADDR=http://localhost:8200 -e VAULT_TOKEN=root vault \
  vault kv get -mount=secret nonexistent >/dev/null 2>&1 || true
docker compose exec -T -e VAULT_ADDR=http://localhost:8200 -e VAULT_TOKEN=root vault \
  vault token lookup >/dev/null 2>&1 || true
if [ -s ./vault/audit/vault-audit.log ]; then
  echo "   audit log present on host: $(pwd)/vault/audit/vault-audit.log"
else
  echo "   vault audit log missing or empty on host" >&2; exit 1
fi
echo "==> applying scheduling-engine migrations to Postgres"
# pgcrypto provides gen_random_uuid() used by the scheduling tables' defaults.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null 2>&1 || true
for f in "$ROOT"/services/scheduling-engine/migrations/*.sql; do
  [ -f "$f" ] || continue
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $(basename "$f")" || echo "   skipped $(basename "$f") (already applied?)"
done

echo "==> applying provisioning-orchestrator async-operation migrations to Postgres"
# Only the migrations the async-operation HTTP slice needs: the async_operations
# table + the columns the create/query actions read. Applied in dependency order
# (073 creates the table other migrations ALTER / reference).
#   073 async_operations + transitions
#   074 async_operation_log_entries
#   075 idempotency_key_records + retry_attempts (+ attempt_count/max_retries cols)
#   076 timeout/cancel/recovery cols + operation_policies (+ status-check widening)
#   078 failure-classification + intervention cols/tables
PO_MIGRATIONS="$ROOT/services/provisioning-orchestrator/src/migrations"
for m in 073-async-operation-tables 074-async-operation-log-entries \
         075-idempotency-retry-tables 076-timeout-cancel-recovery \
         078-retry-semantics-intervention; do
  f="$PO_MIGRATIONS/$m.sql"
  [ -f "$f" ] || { echo "   MISSING $m.sql" >&2; continue; }
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $m" || echo "   skipped $m (already applied?)"
done

echo "==> applying provisioning-orchestrator plan + quota + entitlements migrations to Postgres"
# Only the migrations the plan/quota/entitlements HTTP slices need, in dependency
# order:
#   097 plans + tenant_plan_assignments + plan_audit_events
#       (+ set_updated_at_timestamp() function used by 098/104)
#   098 quota_dimension_catalog (+ seeds the 8 default dimensions the
#       quota-dimension-catalog-list action returns)
#   100 tenant_plan_change_history + quota/capability impacts (plan-change audit)
#   103 quota_overrides (+ plans.quota_type_config) — resolveUnifiedEntitlements
#       LEFT JOINs quota_overrides, so the entitlements query needs this table
#   104 boolean_capability_catalog (+ seeds) — resolveUnifiedEntitlements queries
#       it optionally (its 42P01 is caught), but seeding it exercises the full
#       capability-resolution path
for m in 097-plan-entity-tenant-assignment 098-plan-base-limits \
         100-plan-change-impact-history 103-hard-soft-quota-overrides \
         104-plan-boolean-capabilities; do
  f="$PO_MIGRATIONS/$m.sql"
  [ -f "$f" ] || { echo "   MISSING $m.sql" >&2; continue; }
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test < "$f" >/dev/null 2>&1 \
    && echo "   applied $m" || echo "   skipped $m (already applied?)"
done

# ---- HTTP request-chain slice (scheduling only) ----------------------------
# Concrete tenant/workspace the slice user is bound to (mirrors env.sh).
E2E_TENANT_ID="${E2E_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
E2E_WORKSPACE_ID="${E2E_WORKSPACE_ID:-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}"
# A DIFFERENT tenant used only as the owner of a SHARED-instance backup snapshot,
# to prove tenant A never sees another tenant's shared rows (data-layer probe).
E2E_TENANT_B_ID="${E2E_TENANT_B_ID:-22222222-2222-2222-2222-222222222222}"

# ---- backup-status fixtures (data-layer tenant-isolation probe) -------------
# Seed the backup_status_snapshots table (created by migration 001 above) so the
# backup-status family returns REAL rows instead of an empty "not enabled" 200,
# and so the smoke can prove the data layer — not just the auth gate — keeps
# tenants apart. Two rows:
#   A) tenant A, is_shared_instance=FALSE  -> tenant A's own-tenant view SEES it.
#   B) tenant B, is_shared_instance=TRUE   -> tenant A (read:own, no platform/
#      technical scope) MUST NOT see it: getByTenant(includeShared:false) filters
#      it at the SQL layer (WHERE tenant_id=$1 AND is_shared_instance=FALSE) and
#      two in-action belts drop it again. A technical-scoped global caller
#      (superadmin) DOES see it via getAll(includeShared:true).
# Idempotent: ON CONFLICT on the (tenant_id, component_type, instance_id) unique
# constraint does nothing on re-run.
echo "==> seeding backup_status_snapshots fixtures (tenant A own + tenant B shared)"
# if/then/else with the heredoc directly on the command line — avoids the bash
# heredoc + backslash-continuation footgun (where the body would be mis-collected).
if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test >/dev/null 2>&1 <<SQL
INSERT INTO backup_status_snapshots
  (tenant_id, component_type, instance_id, instance_label, deployment_profile,
   is_shared_instance, status, last_successful_backup_at, last_checked_at, detail)
VALUES
  ('$E2E_TENANT_ID', 'postgres', 'pg-tenant-a-1', 'tenant-a-primary-db', 'dedicated',
   FALSE, 'success', NOW(), NOW(), 'tenant A dedicated database'),
  ('$E2E_TENANT_B_ID', 'object-store', 'minio-shared-1', 'shared-platform-objectstore', 'shared',
   TRUE, 'success', NOW(), NOW(), 'platform-shared object store owned by tenant B')
ON CONFLICT (tenant_id, component_type, instance_id) DO NOTHING;
SQL
then
  echo "   seeded backup snapshots (own=tenant-a-primary-db, shared=shared-platform-objectstore)"
else
  echo "   skipped backup snapshot seed (table missing or already seeded?)"
fi

# ---- entitlements fixtures (real plan-derived limits, not catalog defaults) -
# Assign a real plan to tenant A so tenant-effective-entitlements-get returns
# plan-derived limits (planSlug set, a dimension sourced from 'plan') instead of
# the catalog-default fallback. resolveUnifiedEntitlements LEFT JOINs
# tenant_plan_assignments (097) + plans (097); for any dimension present in the
# plan's quota_dimensions JSONB it reports source='plan' with the plan's value,
# else 'catalog_default'. We give the plan max_workspaces=50 (a seeded catalog
# dimension), so that dimension resolves to source='plan', effectiveValue=50.
# Idempotent: the plan upserts on its unique LOWER(slug) index and the assignment
# is guarded by NOT EXISTS (+ the partial unique index on the active row).
echo "==> seeding entitlements fixture (assign plan 'e2e-pro-plan' to tenant A)"
if docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U falcone -d falcone_test >/dev/null 2>&1 <<SQL
WITH plan_upsert AS (
  INSERT INTO plans (slug, display_name, description, status, quota_dimensions, capabilities, created_by, updated_by)
  VALUES ('e2e-pro-plan', 'E2E Pro Plan', 'Seeded by tests/env/up.sh for the entitlements slice', 'active',
          '{"max_workspaces": 50}'::jsonb, '{}'::jsonb, 'e2e-seed', 'e2e-seed')
  ON CONFLICT (LOWER(slug)) DO NOTHING
  RETURNING id
),
resolved AS (
  SELECT id FROM plan_upsert
  UNION ALL
  SELECT id FROM plans WHERE LOWER(slug) = LOWER('e2e-pro-plan')
)
INSERT INTO tenant_plan_assignments (tenant_id, plan_id, assigned_by)
SELECT '$E2E_TENANT_ID', (SELECT id FROM resolved LIMIT 1), 'e2e-seed'
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_plan_assignments WHERE tenant_id = '$E2E_TENANT_ID' AND superseded_at IS NULL
);
SQL
then
  echo "   assigned plan e2e-pro-plan (max_workspaces=50) to tenant A"
else
  echo "   skipped plan assignment seed (tables missing or already assigned?)"
fi

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
echo "  Redpanda (Kafka)       : localhost:19092"
echo "  MongoDB (rs0)          : mongodb://localhost:57017/?replicaSet=rs0&directConnection=true"
echo "  MinIO S3 API           : http://localhost:59000  (minioadmin/minioadmin), bucket falcone-test"
echo "  MinIO console          : http://localhost:59001"
echo "  Vault (dev)            : http://localhost:58200  (token root)"
echo "  Vault audit log (host) : $(pwd)/vault/audit/vault-audit.log"
echo "  API gateway (APISIX)   : http://localhost:9080  (routes /v1/scheduling/*, /v1/async-operations[/{id}], /v1/admin/config/format-versions, /v1/plans, /v1/quota-dimensions, /v1/tenant/entitlements, /v1/backups/status)"
echo "                            NOTE /v1/backups/status authenticates IN-ACTION (plain proxy, no gateway jwt-auth): the backup-status action verifies the Bearer JWT itself against the realm JWKS and reads tenant+scopes from the token's own claims."
echo "                            backup_status_snapshots seeded with a tenant-A own row + a tenant-B SHARED row -> the smoke proves tenant A never sees tenant B's shared row (data-layer isolation), while a technical-scoped global view sees both."
echo "  action-runner shim     : http://localhost:8090  (/healthz, bypasses gateway)"
echo "  Keycloak realm (slice) : falcone-e2e  client=falcone-e2e-client users=e2e-user/e2e-password (tenant_owner), e2e-superadmin/e2e-superadmin-password (superadmin)"
echo
echo "Point a shell/test at it with:  source tests/env/env.sh"
echo "Run the HTTP-slice smoke with:  bash tests/env/e2e-smoke/run.sh"
