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
docker compose up -d

echo "==> waiting for health"
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
echo
echo "Point a shell/test at it with:  source tests/env/env.sh"
