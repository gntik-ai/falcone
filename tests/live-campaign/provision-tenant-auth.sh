#!/usr/bin/env bash
# Provision each seeded tenant realm so its users/owner can obtain tokens the
# data-plane accepts. The realm-per-tenant createTenant makes realm+roles+owner but
# NO client and NO tenant_id mapper, so ROPC tokens lack the tenant_id claim the
# executor requires ("Missing tenant identity") — a FINDING. Here we create an
# `app-client` (public, direct-access-grants) with a hardcoded tenant_id=<realm> claim
# mapper, replicating the per-project auth-method configuration the model implies.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"; export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS=falcone
PF=""; trap '[ -n "$PF" ] && kill $PF 2>/dev/null' EXIT
kubectl port-forward -n "$NS" svc/falcone-keycloak 8080:8080 >/dev/null 2>&1 & PF=$!; sleep 3
KC=http://localhost:8080
AU=$(kubectl get secret in-falcone-keycloak-admin -n "$NS" -o jsonpath='{.data.username}'|base64 -d)
AP=$(kubectl get secret in-falcone-keycloak-admin -n "$NS" -o jsonpath='{.data.password}'|base64 -d)
T=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli -d "username=$AU" -d "password=$AP"|sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
A=(-s -H "Authorization: Bearer $T" -H 'Content-Type: application/json')

for REALM in $(jq -r '.tenants[]|select(.id!=null).id' "$ROOT/tests/live-campaign/.fixtures.json"); do
  echo "=== realm $REALM ==="
  # client with hardcoded tenant_id claim + realm-roles in access token
  body=$(jq -n --arg r "$REALM" '{
    clientId:"app-client", protocol:"openid-connect", publicClient:true,
    directAccessGrantsEnabled:true, standardFlowEnabled:true, serviceAccountsEnabled:false,
    redirectUris:["*"], webOrigins:["*"], fullScopeAllowed:true,
    protocolMappers:[
      {name:"tenant_id", protocol:"openid-connect", protocolMapper:"oidc-hardcoded-claim-mapper",
       config:{"claim.name":"tenant_id","claim.value":$r,"jsonType.label":"String",
               "access.token.claim":"true","id.token.claim":"true","userinfo.token.claim":"true"}},
      {name:"realm-roles", protocol:"openid-connect", protocolMapper:"oidc-usermodel-realm-role-mapper",
       config:{"claim.name":"realm_access.roles","jsonType.label":"String","multivalued":"true",
               "access.token.claim":"true"}}
    ]}')
  st=$(curl "${A[@]}" -o /dev/null -w '%{http_code}' -X POST "$KC/admin/realms/$REALM/clients" -d "$body")
  echo "  app-client create -> $st"
  # set tenant_id attribute on all users (belt-and-suspenders) + ensure enabled
  for uid in $(curl "${A[@]}" "$KC/admin/realms/$REALM/users?max=100"|jq -r '.[].id'); do
    curl "${A[@]}" -o /dev/null -w '' -X PUT "$KC/admin/realms/$REALM/users/$uid" \
      -d "$(jq -n --arg r "$REALM" '{enabled:true,emailVerified:true,requiredActions:[],attributes:{tenant_id:[$r]}}')"
  done
  echo "  users updated (tenant_id attr + enabled)"
done
echo "DONE"
