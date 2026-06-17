#!/usr/bin/env bash
# Provision the Keycloak platform realm (in-falcone-platform) directly via the admin API
# using the chart's OWN bootstrap payload ConfigMap. This replicates the bootstrap Job's
# one-shot phase (realm + roles + client-scopes + clients + superadmin) deterministically,
# because the chart bootstrap Job fails on this fresh kind install (FINDING). Idempotent.
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"; export KUBECONFIG="$ROOT/kubeconfig-test-cluster-b.yaml"
NS=falcone; REALM=in-falcone-platform
PF=""; cleanup(){ [ -n "$PF" ] && kill "$PF" 2>/dev/null; }; trap cleanup EXIT
kubectl port-forward -n "$NS" svc/falcone-keycloak 8080:8080 >/dev/null 2>&1 & PF=$!; sleep 4
KC=http://localhost:8080
sd(){ kubectl get secret "$1" -n "$NS" -o jsonpath="{.data.$2}" | base64 -d; }
AU="$(sd in-falcone-keycloak-admin username)"; AP="$(sd in-falcone-keycloak-admin password)"
SUPW="$(sd in-falcone-superadmin password)"
pl(){ kubectl get cm falcone-in-falcone-bootstrap-payload -n "$NS" -o jsonpath="{.data.$1}"; }

TOKEN="$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d "username=$AU" -d "password=$AP" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || { echo "FATAL: no admin token"; exit 1; }
echo "admin token OK"
A=(-s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

post(){ # post <url> <json> ; echoes status
  curl "${A[@]}" -o /tmp/kc-resp -w '%{http_code}' -X POST "$1" -d "$2"; }
put(){ curl "${A[@]}" -o /tmp/kc-resp -w '%{http_code}' -X PUT "$1" -d "$2"; }

# 1. realm — try the chart payload; if 4xx, print the error so we can sanitize.
R="$(pl 'realm\.json')"
st=$(post "$KC/admin/realms" "$R"); echo "realm POST -> $st"
if [ "$st" = "409" ]; then echo "  realm exists"; elif [ "$st" -ge 300 ] 2>/dev/null; then
  echo "  realm error body: $(head -c 300 /tmp/kc-resp)"
  # sanitize: KC26 rejects unknown/null top-level fields; keep only safe core fields.
  San="$(echo "$R" | jq '{realm, enabled, displayName, registrationAllowed:true, loginWithEmailAllowed:true, rememberMe:true, resetPasswordAllowed:true, verifyEmail:false, attributes}')"
  st=$(post "$KC/admin/realms" "$San"); echo "  sanitized realm POST -> $st ($(head -c 200 /tmp/kc-resp))"
fi

# 2. user-profile (PUT, optional)
UP="$(pl 'user-profile\.json')"; [ -n "$UP" ] && { st=$(put "$KC/admin/realms/$REALM/users/profile" "$UP"); echo "user-profile PUT -> $st"; }

# 3. roles
for k in $(kubectl get cm falcone-in-falcone-bootstrap-payload -n "$NS" -o json | jq -r '.data|keys[]|select(startswith("role-"))'); do
  st=$(post "$KC/admin/realms/$REALM/roles" "$(pl "$(echo $k|sed 's/\./\\./g')")"); echo "role ${k#role-} -> $st"
done
# 4. client-scopes
for k in $(kubectl get cm falcone-in-falcone-bootstrap-payload -n "$NS" -o json | jq -r '.data|keys[]|select(startswith("client-scope-"))'); do
  st=$(post "$KC/admin/realms/$REALM/client-scopes" "$(pl "$(echo $k|sed 's/\./\\./g')")"); echo "scope ${k#client-scope-} -> $st"
done
# 5. clients
for k in $(kubectl get cm falcone-in-falcone-bootstrap-payload -n "$NS" -o json | jq -r '.data|keys[]|select(startswith("client-")and(startswith("client-scope-")|not))'); do
  st=$(post "$KC/admin/realms/$REALM/clients" "$(pl "$(echo $k|sed 's/\./\\./g')")"); echo "client ${k#client-} -> $st"
done

# 6. superadmin user + password + role
SA="$(pl 'superadmin\.json')"
st=$(post "$KC/admin/realms/$REALM/users" "$SA"); echo "superadmin create -> $st"
UID_="$(curl "${A[@]}" "$KC/admin/realms/$REALM/users?username=superadmin&exact=true" | jq -r '.[0].id')"
echo "superadmin id=$UID_"
if [ -n "$UID_" ] && [ "$UID_" != "null" ]; then
  st=$(put "$KC/admin/realms/$REALM/users/$UID_/reset-password" \
    "$(jq -n --arg p "$SUPW" '{type:"password",value:$p,temporary:false}')"); echo "  set password -> $st"
  RID="$(curl "${A[@]}" "$KC/admin/realms/$REALM/roles/superadmin" | jq -r '.id')"
  if [ -n "$RID" ] && [ "$RID" != "null" ]; then
    st=$(post "$KC/admin/realms/$REALM/users/$UID_/role-mappings/realm" \
      "$(jq -n --arg id "$RID" '[{id:$id,name:"superadmin"}]')"); echo "  assign superadmin role -> $st"
  fi
fi
echo "=== realm well-known: $(curl -s -o /dev/null -w '%{http_code}' "$KC/realms/$REALM/.well-known/openid-configuration") ==="
echo "DONE"
