#!/usr/bin/env bash
# End-to-end smoke for the scheduling HTTP request-chain slice.
#
# Exercises the REAL chain on docker-compose:
#   Keycloak (ROPC token) -> APISIX (JWT validate + identity-header inject)
#   -> action-runner shim -> scheduling-management action -> Postgres.
#
# Assumes `tests/env/up.sh` has already booted + provisioned the stack.
# Asserts: an AUTHENTICATED request succeeds end-to-end (POST 201, GET lists it).
# No assertion is weakened: a missing token MUST 401, the created job MUST appear.
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

echo
echo "E2E SMOKE PASSED: Keycloak -> APISIX -> action-runner -> action -> Postgres (authenticated 201 + list)."
