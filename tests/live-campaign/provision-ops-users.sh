#!/usr/bin/env bash
# Provision a platform-realm "tenant operator" user per seeded tenant:
#   <slug>-ops  with attribute tenant_id=<tenantId>, realm role tenant_owner, known pw.
#
# WHY (finding A3): createTenant puts the tenant OWNER in a per-tenant realm that has no
# usable console client / tenant_id mapper, and the executor/control-plane verify JWTs
# against the PLATFORM realm JWKS — so the as-shipped tenant owner cannot obtain a token
# the platform accepts. The intended "tenant operator authenticates via the platform
# console with a tenant_id claim" path requires a platform-realm user carrying tenant_id.
# The platform realm already has: user-profile attr `tenant_id`, a `tenant-context` client
# scope (oidc-usermodel-attribute-mapper tenant_id->tenant_id) default on in-falcone-console.
# So we just create the user + set the attribute + assign tenant_owner. Idempotent.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"; export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS=falcone; REALM=in-falcone-platform; PW='CampaignPass!2026'
FIX="$ROOT/tests/live-campaign/.fixtures.json"
KC=${KC:-http://localhost:8080}
AU=$(kubectl -n "$NS" get secret in-falcone-keycloak-admin -o jsonpath='{.data.username}'|base64 -d)
AP=$(kubectl -n "$NS" get secret in-falcone-keycloak-admin -o jsonpath='{.data.password}'|base64 -d)
T=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli -d "username=$AU" -d "password=$AP"|sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$T" ] || { echo "FATAL: no admin token"; exit 1; }
A=(-s -H "Authorization: Bearer $T" -H 'Content-Type: application/json')
RID=$(curl "${A[@]}" "$KC/admin/realms/$REALM/roles/tenant_owner" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')

for row in $(python3 -c 'import json;[print(t["slug"]+":"+t["id"]) for t in json.load(open("'"$FIX"'"))["tenants"] if t.get("id")]'); do
  slug="${row%%:*}"; tid="${row##*:}"; u="${slug}-ops"
  echo "=== $u  tenant_id=$tid ==="
  body=$(python3 -c 'import json,sys;print(json.dumps({"username":sys.argv[1],"email":sys.argv[1]+"@ops.test","enabled":True,"emailVerified":True,"attributes":{"tenant_id":[sys.argv[2]]},"credentials":[{"type":"password","value":sys.argv[3],"temporary":False}]}))' "$u" "$tid" "$PW")
  st=$(curl "${A[@]}" -o /dev/null -w '%{http_code}' -X POST "$KC/admin/realms/$REALM/users" -d "$body")
  echo "  create -> $st"
  uid=$(curl "${A[@]}" "$KC/admin/realms/$REALM/users?username=$u&exact=true" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')
  if [ "$st" = 409 ] || [ -z "$uid" ]; then
    uid=$(curl "${A[@]}" "$KC/admin/realms/$REALM/users?username=$u&exact=true" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')
    # ensure attribute + password on the existing user
    curl "${A[@]}" -o /dev/null -X PUT "$KC/admin/realms/$REALM/users/$uid" -d "$(python3 -c 'import json,sys;print(json.dumps({"enabled":True,"emailVerified":True,"attributes":{"tenant_id":[sys.argv[1]]}}))' "$tid")"
    curl "${A[@]}" -o /dev/null -X PUT "$KC/admin/realms/$REALM/users/$uid/reset-password" -d "$(python3 -c 'import json,sys;print(json.dumps({"type":"password","value":sys.argv[1],"temporary":False}))' "$PW")"
  fi
  if [ -n "$uid" ] && [ -n "$RID" ]; then
    st=$(curl "${A[@]}" -o /dev/null -w '%{http_code}' -X POST "$KC/admin/realms/$REALM/users/$uid/role-mappings/realm" -d "[{\"id\":\"$RID\",\"name\":\"tenant_owner\"}]")
    echo "  assign tenant_owner -> $st  (uid=$uid)"
  fi
done
echo "DONE"
