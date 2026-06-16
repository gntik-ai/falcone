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

# Document store — FerretDB gateway over the DocumentDB engine (MongoDB wire protocol),
# host-mapped on 57017. No replica set: FerretDB has no MongoDB change streams; realtime/CDC
# uses Postgres logical replication (set MONGO_BACKEND=ferretdb).
export MONGO_URI="mongodb://falcone:falcone@localhost:57017/"
export MONGO_BACKEND="ferretdb"
export MONGO_TEST_URI="$MONGO_URI"

# SeaweedFS (S3-compatible object storage; replaces MinIO — ADR-13). Path-style on
# :58333. Both env-var spellings are exported so the openapi-sdk-service
# (S3_ACCESS_KEY/S3_SECRET_KEY) and the provisioning-orchestrator
# (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) collectors both resolve. Credentials match
# tests/env/seaweedfs/conf/s3-identities.json.
export S3_ENDPOINT="http://localhost:58333"
export S3_ACCESS_KEY_ID="falconedev"
export S3_ACCESS_KEY="falconedev"
export S3_SECRET_ACCESS_KEY="falconedevsecret"
export S3_SECRET_KEY="falconedevsecret"
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

# ---- HTTP request-chain slice ----------------------------------------------
# APISIX is the gateway in front of the action-runner shim. Families behind it:
#   /v1/scheduling/*                  -> scheduling-engine scheduling-management
#   /v1/async-operations[ /{id} ]     -> provisioning-orchestrator async-operation
#   /v1/admin/config/format-versions  -> provisioning-orchestrator tenant-config
#   /v1/plans                         -> provisioning-orchestrator plan (create/list)
#   /v1/quota-dimensions              -> provisioning-orchestrator quota dimension catalog
export APISIX_BASE_URL="http://localhost:9080"
# Direct shim URL (bypasses the gateway — used by layer-1 checks only).
export ACTION_RUNNER_URL="http://localhost:8090"

# Keycloak realm + ROPC client/user provisioned by keycloak-e2e-provision.sh.
# The access token carries claims tenant_id/workspace_id/actor_roles/actor_type/
# actor_scopes + sub that APISIX injects as x-tenant-id/x-workspace-id/
# x-actor-roles/x-actor-type/x-actor-scopes/x-auth-subject.
export E2E_REALM="falcone-e2e"
export E2E_CLIENT_ID="falcone-e2e-client"   # public client, Direct Access Grants
export E2E_USERNAME="e2e-user"
export E2E_PASSWORD="e2e-password"
export E2E_ROLE="scheduling.admin"
export E2E_JWKS_URL="http://localhost:8081/realms/falcone-e2e/protocol/openid-connect/certs"
export E2E_ISSUER="http://localhost:8081/realms/falcone-e2e"

# Identity the slice user is bound to (token claims tenant_id/workspace_id).
export E2E_TENANT_ID="11111111-1111-1111-1111-111111111111"
export E2E_WORKSPACE_ID="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
# actor_type must be one of the async-operation create model's accepted values;
# actor_scope grants the tenant-config format-versions action its required scope.
export E2E_ACTOR_TYPE="tenant_owner"
export E2E_ACTOR_SCOPE="platform:admin:config:export"

# Dedicated superadmin ROPC user for the plan + quota families (those actions
# read params.callerContext.actor and require actor.type 'superadmin'). Same
# realm/client, actor_type=superadmin. Keeps the tenant_owner-scoped families
# (scheduling/async-operation) untouched.
export E2E_SUPER_USERNAME="e2e-superadmin"
export E2E_SUPER_PASSWORD="e2e-superadmin-password"
