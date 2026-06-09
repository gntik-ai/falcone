#!/usr/bin/env bash
# End-to-end smoke for the HTTP request-chain slice (multiple action families).
#
# Exercises the REAL chain on docker-compose:
#   Keycloak (ROPC token) -> APISIX (JWT validate + identity-header inject)
#   -> action-runner shim -> PRODUCT action -> Postgres.
#
# Families covered (each authenticated end-to-end, plus a 401 probe):
#   [0-4]  scheduling           /v1/scheduling/*                 (POST 201 + list)
#   [5-8]  async-operation      /v1/async-operations[ /{id} ]    (POST 200 + detail + list)
#   [9-10] tenant-config        /v1/admin/config/format-versions (GET 200 + body)
#   [11-14] plan catalog        /v1/plans                        (POST 201 + list, superadmin)
#   [15-16] quota dimensions    /v1/quota-dimensions             (GET 200 + seeded catalog, superadmin)
#   [17-20] entitlements        /v1/tenant/entitlements          (tenant-scoped: own 200 + IDOR 403)
#
# Steps 0-10 use the tenant_owner user; steps 11-16 use the dedicated superadmin
# user (the plan/quota actions require actor.type 'superadmin'). Steps 17-20 are
# the FIRST tenant-scoped family: a tenant_owner reads only its own tenant, and a
# ?tenantId=<other> is a cross-tenant IDOR attempt the action rejects with 403.
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

# ---- plan catalog family (provisioning-orchestrator) -----------------------
# plan-create / plan-list: main(params, overrides), db injected via overrides.db,
# identity via params.callerContext built by the shim from the trusted x-* headers
# (params-callercontext-overrides invoke). Both require actor.type 'superadmin',
# so this family uses a dedicated superadmin ROPC user. plan-create returns 201.

SUPER_USER="${E2E_SUPER_USERNAME:-e2e-superadmin}"
SUPER_PASS="${E2E_SUPER_PASSWORD:-e2e-superadmin-password}"

echo "==> [11] gateway rejects unauthenticated plan request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/plans")
[ "$code" = "401" ] || fail "expected 401 without token on /v1/plans, got $code"
pass "plans unauthenticated -> 401"

echo "==> [12] ROPC login as superadmin ($SUPER_USER)"
STOKEN=$(curl -s -X POST "$KC/realms/$REALM/protocol/openid-connect/token" \
  -d grant_type=password -d "client_id=$CLIENT" \
  -d "username=$SUPER_USER" -d "password=$SUPER_PASS" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(!j.access_token){console.error(d);process.exit(1)}process.stdout.write(j.access_token)})')
[ -n "$STOKEN" ] || fail "no access_token for superadmin from Keycloak"
pass "got superadmin access_token (len ${#STOKEN})"

echo "==> [12b] non-superadmin (tenant_owner) is FORBIDDEN from creating a plan -> 403"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$APISIX/v1/plans" -d '{"slug":"should-not-exist","displayName":"Nope"}')
[ "$code" = "403" ] || fail "expected 403 for tenant_owner creating a plan, got $code"
pass "tenant_owner plan create -> 403 (superadmin-only enforced)"

echo "==> [13] authenticated POST /v1/plans (superadmin) -> expect 201 with plan id"
PSLUG="smoke-plan-$(date +%s)-$$"
PCREATE=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $STOKEN" -H 'content-type: application/json' \
  -X POST "$APISIX/v1/plans" \
  -d "{\"slug\":\"$PSLUG\",\"displayName\":\"Smoke Plan\",\"description\":\"slice smoke\",\"quotaDimensions\":{\"max_workspaces\":5}}")
PBODY=$(printf '%s' "$PCREATE" | sed '$d')
PCODE=$(printf '%s' "$PCREATE" | tail -n1)
[ "$PCODE" = "201" ] || fail "expected 201 on plan create, got $PCODE: $PBODY"
PLAN_ID=$(printf '%s' "$PBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write(JSON.parse(d).id||"")})')
[ -n "$PLAN_ID" ] || fail "no plan id in create response: $PBODY"
pass "created plan $PLAN_ID slug=$PSLUG (HTTP 201)"

echo "==> [14] authenticated GET /v1/plans (superadmin) -> the new plan is listed"
PLIST=$(curl -s -H "Authorization: Bearer $STOKEN" "$APISIX/v1/plans")
PL_FOUND=$(printf '%s' "$PLIST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String((j.plans||[]).some(p=>p.id==="'"$PLAN_ID"'"&&p.slug==="'"$PSLUG"'")))})')
[ "$PL_FOUND" = "true" ] || fail "created plan $PLAN_ID not found in list: $PLIST"
pass "plan $PLAN_ID present in GET list"

# ---- quota dimension catalog family (provisioning-orchestrator) ------------
# quota-dimension-catalog-list: main(params, overrides), db via overrides.db,
# identity via params.callerContext (superadmin). Reads the quota_dimension_catalog
# table seeded by migration 098 (8 default dimensions). Returns 200 with the list.

echo "==> [15] gateway rejects unauthenticated quota-dimensions request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/quota-dimensions")
[ "$code" = "401" ] || fail "expected 401 without token on /v1/quota-dimensions, got $code"
pass "quota-dimensions unauthenticated -> 401"

echo "==> [16] authenticated GET /v1/quota-dimensions (superadmin) -> 200 with seeded catalog"
QD=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $STOKEN" "$APISIX/v1/quota-dimensions")
QDBODY=$(printf '%s' "$QD" | sed '$d')
QDCODE=$(printf '%s' "$QD" | tail -n1)
[ "$QDCODE" = "200" ] || fail "expected 200 on quota-dimensions, got $QDCODE: $QDBODY"
QD_OK=$(printf '%s' "$QDBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const dims=j.dimensions||[];process.stdout.write(String(Array.isArray(dims)&&j.total>=8&&dims.some(x=>x.dimensionKey==="max_workspaces")))})')
[ "$QD_OK" = "true" ] || fail "quota-dimensions body missing seeded dimensions (expected >=8 incl max_workspaces): $QDBODY"
pass "quota-dimensions returned seeded catalog (>=8 dimensions incl max_workspaces)"

# ---- tenant effective entitlements family (provisioning-orchestrator) -------
# tenant-effective-entitlements-get: main(params, overrides), db via overrides.db,
# identity via params.callerContext built by the shim from the trusted x-* headers
# (params-callercontext-overrides invoke). This is the FIRST tenant-scoped
# (non-superadmin) family: a tenant_owner reads ONLY its own tenant. The action's
# authz throws FORBIDDEN (403) BEFORE any DB access when ?tenantId=<other> does
# not match the caller's tenant -> the cross-tenant IDOR probe. For an unseeded
# tenant it returns 200 with catalog-default quantitative limits and planSlug:null.

TENANT_B="22222222-2222-2222-2222-222222222222"  # a DIFFERENT tenant (need not exist; 403 fires pre-DB)

echo "==> [17] gateway rejects unauthenticated tenant-entitlements request"
code=$(curl -s -o /dev/null -w '%{http_code}' "$APISIX/v1/tenant/entitlements")
[ "$code" = "401" ] || fail "expected 401 without token on /v1/tenant/entitlements, got $code"
pass "tenant-entitlements unauthenticated -> 401"

echo "==> [18] tenant_owner GET /v1/tenant/entitlements (own tenant) -> 200 catalog defaults"
ENT=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$APISIX/v1/tenant/entitlements")
ENTBODY=$(printf '%s' "$ENT" | sed '$d')
ENTCODE=$(printf '%s' "$ENT" | tail -n1)
[ "$ENTCODE" = "200" ] || fail "expected 200 on own-tenant entitlements, got $ENTCODE: $ENTBODY"
ENT_OK=$(printf '%s' "$ENTBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const q=j.quantitativeLimits||[];process.stdout.write(String(Array.isArray(q)&&q.length>0&&j.planSlug===null))})')
[ "$ENT_OK" = "true" ] || fail "own-tenant entitlements body missing non-empty quantitativeLimits / planSlug!=null: $ENTBODY"
pass "tenant_owner own-tenant entitlements -> 200 (non-empty quantitativeLimits, planSlug null)"

echo "==> [19] IDOR PROBE: tenant_owner GET /v1/tenant/entitlements?tenantId=<TENANT_B> -> 403 (cross-tenant read blocked)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$APISIX/v1/tenant/entitlements?tenantId=$TENANT_B")
[ "$code" = "403" ] || fail "expected 403 for tenant_owner reading another tenant's entitlements (IDOR), got $code"
pass "IDOR blocked: tenant_owner cross-tenant entitlements read -> 403"

echo "==> [20] superadmin GET /v1/tenant/entitlements?tenantId=<own tenant> -> 200 (may cross-scope)"
SENT=$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $STOKEN" "$APISIX/v1/tenant/entitlements?tenantId=$E2E_TENANT_ID")
SENTBODY=$(printf '%s' "$SENT" | sed '$d')
SENTCODE=$(printf '%s' "$SENT" | tail -n1)
[ "$SENTCODE" = "200" ] || fail "expected 200 for superadmin scoped entitlements, got $SENTCODE: $SENTBODY"
SENT_OK=$(printf '%s' "$SENTBODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.stdout.write(String(Array.isArray(j.quantitativeLimits)&&j.quantitativeLimits.length>0))})')
[ "$SENT_OK" = "true" ] || fail "superadmin scoped entitlements body missing non-empty quantitativeLimits: $SENTBODY"
pass "superadmin scoped entitlements (explicit tenantId) -> 200 (cross-scope allowed)"

echo
echo "E2E SMOKE PASSED: Keycloak -> APISIX -> action-runner -> {scheduling, async-operation, tenant-config, plan, quota, entitlements} actions -> Postgres."
echo "  scheduling           : 401 + POST 201 + list"
echo "  async-operation      : 401 + POST 200 + detail + list"
echo "  tenant-config formats: 401 + GET 200 + body"
echo "  plan catalog         : 401 + tenant_owner 403 + superadmin POST 201 + list"
echo "  quota dimensions     : 401 + superadmin GET 200 + seeded catalog"
echo "  entitlements (tenant): 401 + tenant_owner own 200 + IDOR cross-tenant 403 + superadmin scoped 200"
