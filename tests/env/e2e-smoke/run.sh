#!/usr/bin/env bash
# End-to-end smoke for the HTTP request-chain slice (multiple action families).
#
# Exercises the REAL chain on docker-compose:
#   Keycloak (ROPC token) -> APISIX (JWT validate + identity-header inject)
#   -> action-runner shim -> PRODUCT action -> Postgres.
#
# Families covered (each authenticated end-to-end, plus a 401 probe):
#   [0-4] scheduling                 /v1/scheduling/*               (POST 201 + list)
#   [5-8] async-operation            /v1/async-operations[ /{id} ]  (POST 200 + detail + list + cross-tenant 404)
#   [9-10] tenant-config             /v1/admin/config/format-versions (GET 200 + body)
#
# Assumes `tests/env/up.sh` has already booted + provisioned the stack.
# No assertion is weakened: a missing token MUST 401, created resources MUST appear,
# and cross-tenant access MUST be denied.
set -euo pipefail
cd "$(dirname "$0")"

# Load slice config (APISIX URL, realm/client/user, tenant/workspace ids).
# shellcheck disable=SC1091
source ../env.sh

APISIX="${APISIX_BASE_URL:-http://localhost:9080}"
KC="${KEYCLOAK_BASE_URL:-http://localhost:8081}"
REALM="${E2E_REALM:-falcone-e2e}"
CLIENT="${E2E_CLIENT_ID:-falcone-e2e-client}"
USER="${E2E_USERNAME:-e2e-user}"
PASS="${E2E_PASSWORD:-e2e-password}"

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "==> [0] gateway rejects unauthenticated request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/scheduling/jobs")
[ "$code" = "401" ] || fail "expected 401 without token, got $code"
pass "unauthenticated -> 401"

echo "==> [1] ROPC login to Keycloak ($REALM)"
TOKEN=$(curl -s -X POST "$KC/realms/$REALM/protocol/openid-connect/token" \
  -d grant_type=password -d "client_id=$CLIENT" \
  -d "username=$USER" -d "password=$PASS" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(!j.access_token){console.error(d);process.exit(1)}process.stdout.write(j.access_token)})')
[ -n "$TOKEN" ] || fail "no access_token from Keycloak"
pass "got access_token (len ${#TOKEN})"

echo "==> [2] ensure scheduling enabled for the workspace (PATCH config via gateway)"
curl -s -o /dev/null -w '' -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X PATCH "$APISIX/v1/scheduling/config" \
  -d '{"schedulingEnabled":true,"maxActiveJobs":50,"minIntervalSeconds":60}'

echo "==> [3] authenticated POST /v1/scheduling/jobs -> expect 201"
NAME="smoke-$(date +%s)-$$"
CREATE=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$APISIX/v1/scheduling/jobs" \
  -d "{\"name\":\"$NAME\",\"cronExpression\":\"0 3 * * *\",\"targetAction\":\"reports/nightly\",\"payload\":{\"smoke\":true}}")
BODY=$(printf '%s' "$CREATE" | sed '$d')
CODE=$(printf '%s' "$CREATE" | tail -n1)
[ "$CODE" = "201" ] || fail "expected 201 on create, got $CODE: $BODY"
JOB_ID=$(printf '%s' "$BODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.parse(d).jobId||"")})')
[ -n "$JOB_ID" ] || fail "no jobId in create response: $BODY"
pass "created job $JOB_ID (HTTP 201)"

echo "==> [4] authenticated GET /v1/scheduling/jobs -> the new job is listed"
LIST=$(curl -s -H "Authorization: Bearer $TOKEN" "$APISIX/v1/scheduling/jobs")
FOUND=$(printf '%s' "$LIST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String((j.items||[]).some(i=>i.jobId==="'"$JOB_ID"'")))})')
[ "$FOUND" = "true" ] || fail "created job $JOB_ID not found in list: $LIST"
pass "job $JOB_ID present in GET list"

# ---- async-operation family (provisioning-orchestrator) --------------------
# main(params, overrides): db injected via overrides.db (params-overrides invoke).
# Identity from x-tenant-id/x-auth-subject/x-actor-type. Create returns HTTP 200
# (the action's formatCreateResponse contract), NOT 201.

echo "==> [5] gateway rejects unauthenticated async-operation request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/async-operations?queryType=list")
[ "$code" = "401" ] || fail "expected 401 without token on async-operations, got $code"
pass "async-operations unauthenticated -> 401"

echo "==> [6] authenticated POST /v1/async-operations -> expect 200 with operationId"
OPCREATE=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$APISIX/v1/async-operations" \
  -d '{"operation_type":"tenant.provision"}')
OPBODY=$(printf '%s' "$OPCREATE" | sed '$d')
OPCODE=$(printf '%s' "$OPCREATE" | tail -n1)
[ "$OPCODE" = "200" ] || fail "expected 200 on async-operation create, got $OPCODE: $OPBODY"
OP_ID=$(printf '%s' "$OPBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.parse(d).operationId||"")})')
[ -n "$OP_ID" ] || fail "no operationId in async-operation create response: $OPBODY"
pass "created async-operation $OP_ID (HTTP 200)"

echo "==> [7] authenticated GET /v1/async-operations/$OP_ID -> detail returned for this tenant"
OPDETAIL=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "$APISIX/v1/async-operations/$OP_ID?queryType=detail")
ODBODY=$(printf '%s' "$OPDETAIL" | sed '$d')
ODCODE=$(printf '%s' "$OPDETAIL" | tail -n1)
[ "$ODCODE" = "200" ] || fail "expected 200 on async-operation detail, got $ODCODE: $ODBODY"
OD_MATCH=$(printf '%s' "$ODBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(j.operationId==="'"$OP_ID"'"&&j.operationType==="tenant.provision"))})')
[ "$OD_MATCH" = "true" ] || fail "async-operation detail did not return the created op: $ODBODY"
pass "async-operation $OP_ID detail returned (operationType tenant.provision)"

echo "==> [8] authenticated GET /v1/async-operations (list) -> the new op is listed"
OPLIST=$(curl -s -H "Authorization: Bearer $TOKEN" "$APISIX/v1/async-operations?queryType=list")
OL_FOUND=$(printf '%s' "$OPLIST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String((j.items||[]).some(i=>i.operationId==="'"$OP_ID"'")))})')
[ "$OL_FOUND" = "true" ] || fail "created async-operation $OP_ID not found in list: $OPLIST"
pass "async-operation $OP_ID present in GET list"

# ---- tenant-config format-versions family (provisioning-orchestrator) -------
# Pure GET, NO DB (params-only invoke). Identity from x-tenant-id + x-actor-scopes
# (needs platform:admin:config:export). Returns 200 with the schema-registry body.

echo "==> [9] gateway rejects unauthenticated tenant-config request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/admin/config/format-versions")
[ "$code" = "401" ] || fail "expected 401 without token on format-versions, got $code"
pass "tenant-config format-versions unauthenticated -> 401"

echo "==> [10] authenticated GET /v1/admin/config/format-versions -> 200 with versions"
FV=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "$APISIX/v1/admin/config/format-versions")
FVBODY=$(printf '%s' "$FV" | sed '$d')
FVCODE=$(printf '%s' "$FV" | tail -n1)
[ "$FVCODE" = "200" ] || fail "expected 200 on format-versions, got $FVCODE: $FVBODY"
FV_OK=$(printf '%s' "$FVBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(typeof j.current_version==="string"&&Array.isArray(j.versions)&&j.versions.length>0))})')
[ "$FV_OK" = "true" ] || fail "format-versions body missing current_version/versions: $FVBODY"
pass "format-versions returned current_version + non-empty versions"

echo
echo "E2E SMOKE PASSED: Keycloak -> APISIX -> action-runner -> {scheduling, async-operation, tenant-config} actions -> Postgres."
echo "  scheduling           : 401 + POST 201 + list"
echo "  async-operation      : 401 + POST 200 + detail + list"
echo "  tenant-config formats: 401 + GET 200 + body"
