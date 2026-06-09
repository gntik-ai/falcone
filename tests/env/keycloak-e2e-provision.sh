#!/usr/bin/env bash
# Provision the Keycloak realm used by the HTTP request-chain slice (scheduling).
#
# Creates (idempotently):
#   - realm  falcone-e2e
#   - client falcone-e2e-client (public, Direct Access Grants / ROPC enabled)
#   - realm role  scheduling.admin
#   - user   e2e-user / password e2e-password, with attributes
#       tenant_id    = $E2E_TENANT_ID
#       workspace_id = $E2E_WORKSPACE_ID
#     and the scheduling.admin realm role.
#   - protocol mappers on the client so the issued ACCESS TOKEN carries top-level
#     claims:  tenant_id, workspace_id  (from user attributes) and
#              actor_roles (realm roles, comma-joined, single string)
#     plus the standard `sub` (subject) APISIX maps to x-auth-subject.
#
# These claims are what APISIX proxy-rewrite injects as x-tenant-id /
# x-workspace-id / x-actor-roles / x-auth-subject into the upstream request.
#
# Run via docker compose exec (kcadm lives in the keycloak container). Idempotent.
set -euo pipefail

KC=/opt/keycloak/bin/kcadm.sh
REALM="${E2E_REALM:-falcone-e2e}"
CLIENT_ID="${E2E_CLIENT_ID:-falcone-e2e-client}"
USERNAME="${E2E_USERNAME:-e2e-user}"
PASSWORD="${E2E_PASSWORD:-e2e-password}"
ROLE="${E2E_ROLE:-scheduling.admin}"
TENANT_ID="${E2E_TENANT_ID:?E2E_TENANT_ID required}"
WORKSPACE_ID="${E2E_WORKSPACE_ID:?E2E_WORKSPACE_ID required}"

log() { echo "   $*"; }

dc() { docker compose exec -T keycloak "$@"; }

# 1. Authenticate kcadm against master.
dc "$KC" config credentials --server http://localhost:8080 --realm master \
  --user admin --password admin >/dev/null

# 2. Realm.
if dc "$KC" get "realms/$REALM" >/dev/null 2>&1; then
  log "realm $REALM already exists"
else
  dc "$KC" create realms -s realm="$REALM" -s enabled=true >/dev/null
  log "created realm $REALM"
fi

# 2b. Allow UNMANAGED user attributes. Keycloak 26 enables the declarative user
# profile by default and STRIPS any attribute not declared in the profile, which
# silently drops our custom tenant_id/workspace_id. ENABLED lets admins set
# arbitrary attributes so the attribute mappers can read them into the token.
dc "$KC" update users/profile -r "$REALM" -s 'unmanagedAttributePolicy=ENABLED' >/dev/null 2>&1 \
  && log "enabled unmanaged user attributes" \
  || dc "$KC" update "realms/$REALM" -s 'attributes.userProfileEnabled=true' >/dev/null 2>&1 || true

# 3. Realm role.
if dc "$KC" get "roles/$ROLE" -r "$REALM" >/dev/null 2>&1; then
  log "role $ROLE already exists"
else
  dc "$KC" create roles -r "$REALM" -s name="$ROLE" >/dev/null
  log "created role $ROLE"
fi

# 4. Public client with Direct Access Grants (ROPC) enabled.
CID=$(dc "$KC" get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null | tr -d '\r' | head -n1 || true)
if [ -n "$CID" ]; then
  log "client $CLIENT_ID already exists ($CID)"
else
  dc "$KC" create clients -r "$REALM" \
    -s clientId="$CLIENT_ID" \
    -s enabled=true \
    -s publicClient=true \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=true \
    -s 'redirectUris=["*"]' >/dev/null
  CID=$(dc "$KC" get clients -r "$REALM" -q clientId="$CLIENT_ID" --fields id --format csv --noquotes 2>/dev/null | tr -d '\r' | head -n1)
  log "created public client $CLIENT_ID ($CID)"
fi

# 5. Protocol mappers on the client (idempotent: delete+recreate is messy, so we
#    only create when the named mapper is absent).
create_mapper() {
  local name="$1" json="$2"
  local existing
  existing=$(dc "$KC" get "clients/$CID/protocol-mappers/models" -r "$REALM" \
    --fields name --format csv --noquotes 2>/dev/null | tr -d '\r' | grep -Fx "$name" || true)
  if [ -n "$existing" ]; then
    log "mapper $name already exists"
    return
  fi
  printf '%s' "$json" | dc "$KC" create "clients/$CID/protocol-mappers/models" -r "$REALM" -f - >/dev/null
  log "created mapper $name"
}

# tenant_id <- user attribute tenant_id
create_mapper "tenant_id" '{
  "name":"tenant_id",
  "protocol":"openid-connect",
  "protocolMapper":"oidc-usermodel-attribute-mapper",
  "config":{
    "user.attribute":"tenant_id",
    "claim.name":"tenant_id",
    "jsonType.label":"String",
    "id.token.claim":"true",
    "access.token.claim":"true",
    "userinfo.token.claim":"true"
  }
}'

# workspace_id <- user attribute workspace_id
create_mapper "workspace_id" '{
  "name":"workspace_id",
  "protocol":"openid-connect",
  "protocolMapper":"oidc-usermodel-attribute-mapper",
  "config":{
    "user.attribute":"workspace_id",
    "claim.name":"workspace_id",
    "jsonType.label":"String",
    "id.token.claim":"true",
    "access.token.claim":"true",
    "userinfo.token.claim":"true"
  }
}'

# actor_roles <- realm roles (multivalued array, unprefixed). Includes the
# scheduling.admin role granted to the user. APISIX serialises the array into the
# injected x-actor-roles header; the scheduling action's parseRoles() accepts
# either a JSON array or a comma-joined string.
create_mapper "actor_roles" '{
  "name":"actor_roles",
  "protocol":"openid-connect",
  "protocolMapper":"oidc-usermodel-realm-role-mapper",
  "config":{
    "claim.name":"actor_roles",
    "jsonType.label":"String",
    "multivalued":"true",
    "usermodel.realmRoleMapping.rolePrefix":"",
    "id.token.claim":"true",
    "access.token.claim":"true",
    "userinfo.token.claim":"false"
  }
}'

# 6. Test user with attributes + role.
USER_ID=$(dc "$KC" get users -r "$REALM" -q username="$USERNAME" --fields id --format csv --noquotes 2>/dev/null | tr -d '\r' | head -n1 || true)
if [ -n "$USER_ID" ]; then
  log "user $USERNAME already exists ($USER_ID)"
else
  dc "$KC" create users -r "$REALM" \
    -s username="$USERNAME" \
    -s enabled=true \
    -s emailVerified=true \
    -s "email=${USERNAME}@example.test" \
    -s firstName=E2E \
    -s lastName=User \
    -s 'requiredActions=[]' \
    -s "attributes.tenant_id=$TENANT_ID" \
    -s "attributes.workspace_id=$WORKSPACE_ID" >/dev/null
  USER_ID=$(dc "$KC" get users -r "$REALM" -q username="$USERNAME" --fields id --format csv --noquotes 2>/dev/null | tr -d '\r' | head -n1)
  log "created user $USERNAME ($USER_ID)"
fi

# Always (re)set the password + attributes (idempotent, ensures known state).
# emailVerified + email + cleared requiredActions avoid the ROPC
# "Account is not fully set up" rejection.
dc "$KC" set-password -r "$REALM" --userid "$USER_ID" --new-password "$PASSWORD" >/dev/null
dc "$KC" update "users/$USER_ID" -r "$REALM" \
  -s enabled=true \
  -s emailVerified=true \
  -s "email=${USERNAME}@example.test" \
  -s firstName=E2E \
  -s lastName=User \
  -s 'requiredActions=[]' \
  -s "attributes.tenant_id=[\"$TENANT_ID\"]" \
  -s "attributes.workspace_id=[\"$WORKSPACE_ID\"]" >/dev/null
log "set password + attributes for $USERNAME"

# Grant the realm role to the user (idempotent).
dc "$KC" add-roles -r "$REALM" --uusername "$USERNAME" --rolename "$ROLE" >/dev/null 2>&1 \
  && log "granted role $ROLE to $USERNAME" || log "role $ROLE already granted to $USERNAME"

echo "Keycloak realm '$REALM' provisioned for the scheduling HTTP slice."
