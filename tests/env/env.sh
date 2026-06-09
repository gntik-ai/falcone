# Source this to point a process/test at the Falcone test environment.
#   source tests/env/env.sh
#
# Values match tests/env/docker-compose.yml + the Keycloak provisioning done by up.sh.

# Postgres
export DB_URL="postgres://falcone:falcone@localhost:55432/falcone_test"
export PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone PGDATABASE=falcone_test

# Keycloak (internal IdP). Base URL is what the resolver derives admin/token URLs from.
export KEYCLOAK_BASE_URL="http://localhost:8081"
export KEYCLOAK_JWKS_URL="http://localhost:8081/realms/master/protocol/openid-connect/certs"
export KEYCLOAK_ISSUER="http://localhost:8081/realms/master"
# Admin service account (mirrors the chart secret in-falcone-keycloak-admin).
export KEYCLOAK_ADMIN_CLIENT_ID="falcone-admin"
export KEYCLOAK_ADMIN_CLIENT_SECRET="falcone-admin-secret"

# Kafka (Redpanda) — events, audit, CDC change streams.
export KAFKA_BROKERS="localhost:19092"

# MongoDB — document store; single-node replica set (rs0) so CDC change streams
# work. directConnection avoids client-side replica-set discovery of the in-net
# `mongodb:27017` host (only the host-mapped 57017 is reachable from the host).
export MONGO_URI="mongodb://localhost:57017/?replicaSet=rs0&directConnection=true"
export MONGO_TEST_URI="$MONGO_URI"

# MinIO (S3-compatible object storage). Both env-var spellings are exported so the
# openapi-sdk-service (S3_ACCESS_KEY/S3_SECRET_KEY) and the provisioning-orchestrator
# (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) collectors both resolve.
export S3_ENDPOINT="http://localhost:59000"
export S3_ACCESS_KEY_ID="minioadmin"
export S3_ACCESS_KEY="minioadmin"
export S3_SECRET_ACCESS_KEY="minioadmin"
export S3_SECRET_KEY="minioadmin"
export S3_SDK_BUCKET="falcone-test"

# Vault (dev mode). The file audit device writes to a host-mounted path that
# secret-audit-handler tails (VAULT_AUDIT_LOG_PATH).
export VAULT_ADDR="http://localhost:58200"
export VAULT_TOKEN="root"
# Absolute host path to the file audit log (computed from the repo root).
_FALCONE_ENV_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
export VAULT_AUDIT_LOG_PATH="$_FALCONE_ENV_REPO_ROOT/tests/env/vault/audit/vault-audit.log"
unset _FALCONE_ENV_REPO_ROOT

# Marker + seeded tenants. Realm name == tenantId; displayName is the tenant name.
export FALCONE_TESTENV=1
export TESTENV_TENANT_A="11111111-1111-1111-1111-111111111111"  # displayName: Acme Corporation
export TESTENV_TENANT_B="22222222-2222-2222-2222-222222222222"  # displayName: Globex Industries
