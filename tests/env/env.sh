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

# Marker + seeded tenants. Realm name == tenantId; displayName is the tenant name.
export FALCONE_TESTENV=1
export TESTENV_TENANT_A="11111111-1111-1111-1111-111111111111"  # displayName: Acme Corporation
export TESTENV_TENANT_B="22222222-2222-2222-2222-222222222222"  # displayName: Globex Industries
