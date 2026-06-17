#!/usr/bin/env bash
# Live-stack empirical audit — shared helper library.
#
# Targets the running `falcone` namespace on the local kind cluster (test-cluster-b).
# SECRET-SAFE: reads Kubernetes secrets at runtime to mint short-lived tokens; never
# echoes, logs, or commits any secret value. Tokens are cached in $TMPDIR only.
#
# Requires port-forwards to be running (see lib/pf.sh):
#   svc/falcone-control-plane 18080:8080   -> CP   (http://127.0.0.1:18080)
#   svc/falcone-keycloak      18081:8080   -> KC   (http://127.0.0.1:18081)
# Optional (per capability): postgres 15432, ferretdb 17017, mongodb 27018,
#   seaweedfs-s3 18333, apisix 19080, web-console 13000, prometheus 19090, kafka 19092.
#
# Usage:  source tests/live-audit/lib/lib.sh
set -uo pipefail

LA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$LA_ROOT/../.." && pwd)"
export KUBECONFIG="${KUBECONFIG:-$REPO_ROOT/kubeconfig-test-cluster-b.yaml}"
export NS="${NS:-falcone}"

CP="${CP:-http://127.0.0.1:18080}"          # control-plane / executor (gateway-bypass direct)
KC="${KC:-http://127.0.0.1:18081}"          # keycloak
KC_INTERNAL_HOST="${KC_INTERNAL_HOST:-falcone-keycloak:8080}"  # issuer the CP expects
API_VERSION="${API_VERSION:-2026-03-26}"
PLATFORM_REALM="${PLATFORM_REALM:-in-falcone-platform}"

_cache="${TMPDIR:-/tmp}/la-cache"; mkdir -p "$_cache"

# ---- secret access (authorized; values never printed) -----------------------
ksecret() { # ksecret <secret> <key>  -> base64-decoded value on stdout
  kubectl -n "$NS" get secret "$1" -o jsonpath="{.data.$2}" 2>/dev/null | base64 -d
}

# ---- tokens -----------------------------------------------------------------
# Mint (and cache ~50s) a platform realm token via ROPC. Issuer is forced to the
# in-cluster host so the control-plane's JWKS/issuer check passes.
_ropc_token() { # _ropc_token <realm> <client> <user> <password> <host> [scope]
  curl -s "$KC/realms/$1/protocol/openid-connect/token" \
    -H "Host: ${5}" \
    -d "client_id=$2" --data-urlencode "username=$3" --data-urlencode "password=$4" \
    -d grant_type=password -d "scope=${6:-openid}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null
}

sa_token() { # superadmin platform token (cached)
  local f="$_cache/sa.tok"
  if [ -f "$f" ] && [ $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 50 ]; then cat "$f"; return; fi
  local pw t; pw="$(ksecret in-falcone-superadmin password)"
  t="$(_ropc_token "$PLATFORM_REALM" in-falcone-console superadmin "$pw" "$KC_INTERNAL_HOST")"
  [ -n "$t" ] && printf '%s' "$t" > "$f"; printf '%s' "$t"
}

# token for an arbitrary realm user (per-tenant realm auth-as-a-service)
user_token() { # user_token <realm> <client> <user> <password> [host] [scope]
  _ropc_token "$1" "$2" "$3" "$4" "${5:-$KC_INTERNAL_HOST}" "${6:-openid}"
}

# Decode a JWT payload (no verification) — for inspecting claims. Not a secret.
jwt_claims() { cut -d. -f2 | python3 -c 'import sys,base64,json;p=sys.stdin.read().strip();p+="="*(-len(p)%4);print(json.dumps(json.loads(base64.urlsafe_b64decode(p)),indent=2))'; }

# ---- control-plane request wrappers ----------------------------------------
# cp <METHOD> <path> [token] [json-body] [extra-curl-args...]
# Emits: HTTP status on stderr line "HTTP <code>", body on stdout. Adds standard headers.
cp() {
  local method="$1" path="$2" tok="${3:-}" body="${4:-}"; shift; shift; shift || true; shift || true
  local args=(-s -X "$method" "-H" "X-API-Version: $API_VERSION"
              "-H" "X-Correlation-Id: la-$(date +%s%N)"
              "-H" "Idempotency-Key: la-$RANDOM$RANDOM" )
  [ -n "$tok" ] && args+=("-H" "Authorization: Bearer $tok")
  if [ -n "$body" ]; then args+=("-H" "Content-Type: application/json" "--data" "$body"); fi
  curl -g -m 30 -w $'\n__HTTP__%{http_code}' "${args[@]}" "$@" "$CP$path"
}
# Convenience: pretty-print last cp() output split into body + status.
cp_show() { local out; out="$(cat)"; echo "${out%$'\n__HTTP__'*}" | head -c "${LA_BODY_MAX:-2000}"; echo; echo "STATUS: ${out##*__HTTP__}"; }
# Just the status code from a cp() call passed on stdin.
cp_code() { local out; out="$(cat)"; echo "${out##*__HTTP__}"; }
cp_body() { local out; out="$(cat)"; printf '%s' "${out%$'\n__HTTP__'*}"; }

# raw apikey-authenticated request (Authorization: ApiKey ...)
cp_key() { # cp_key <METHOD> <path> <apikey> [json-body]
  local method="$1" path="$2" key="$3" body="${4:-}"
  local args=(-s -X "$method" "-H" "X-API-Version: $API_VERSION"
              "-H" "X-Correlation-Id: la-$(date +%s%N)" "-H" "Idempotency-Key: la-$RANDOM$RANDOM"
              "-H" "Authorization: ApiKey $key")
  [ -n "$body" ] && args+=("-H" "Content-Type: application/json" "--data" "$body")
  curl -g -m 30 -w $'\n__HTTP__%{http_code}' "${args[@]}" "$CP$path"
}

json() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps(d,indent=2))'; }
jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }  # jqp 'd[\"items\"]'

# ---- executor (data-plane) wrappers -----------------------------------------
EXEC="${EXEC:-http://127.0.0.1:18082}"   # cp-executor: serves data-plane locally, proxies mgmt

# Trust-header path (gateway-bypass): the executor trusts x-tenant-id/x-workspace-id when no
# credential is presented. Used for DDL/admin ops and for isolation boundary probes.
# exh <METHOD> <path> <tenantId> <workspaceId> [json-body]
# When LA_GW_SECRET is set, sends the gateway shared-secret header (simulates the
# authenticated gateway) so post-A1 the trust-header path is honored for legit ops.
exh() {
  local method="$1" path="$2" t="$3" w="$4" body="${5:-}"
  local args=(-s -X "$method" -H "x-tenant-id: $t" -H "x-workspace-id: $w"
              -H "X-API-Version: $API_VERSION" -H "X-Correlation-Id: la-$(date +%s%N)"
              -H "Idempotency-Key: la-$RANDOM$RANDOM")
  [ -n "${LA_GW_SECRET:-}" ] && args+=(-H "x-gateway-auth: $LA_GW_SECRET")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  curl -g -m 30 -w $'\n__HTTP__%{http_code}' "${args[@]}" "$EXEC$path"
}

# API-key credential path (what real server-side apps use): Authorization: ApiKey flc_...
# exk <METHOD> <path> <apikey> [json-body]
exk() {
  local method="$1" path="$2" key="$3" body="${4:-}"
  local args=(-s -X "$method" -H "Authorization: ApiKey $key"
              -H "X-API-Version: $API_VERSION" -H "X-Correlation-Id: la-$(date +%s%N)"
              -H "Idempotency-Key: la-$RANDOM$RANDOM")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data "$body")
  curl -g -m 30 -w $'\n__HTTP__%{http_code}' "${args[@]}" "$EXEC$path"
}

# Raw executor curl (caller supplies all headers). erq <curl-args...> <path-suffix appended to $EXEC>
body_of() { local out; out="$(cat)"; printf '%s' "${out%$'\n__HTTP__'*}"; }
code_of() { local out; out="$(cat)"; echo "${out##*__HTTP__}"; }
show()    { local out; out="$(cat)"; echo "${out%$'\n__HTTP__'*}" | head -c "${LA_BODY_MAX:-1600}"; echo; echo "STATUS: ${out##*__HTTP__}"; }

# Mint a workspace API key via the trust-header path. mint_key <tenantId> <wsId> <keyType> [scopesJSON]
# Prints the flc_ key value on stdout (caller should capture, NOT echo into reports).
mint_key() {
  local t="$1" w="$2" kt="${3:-service}" scopes="${4:-[\"postgres:read\",\"postgres:write\",\"mongo:read\",\"mongo:write\",\"storage:read\",\"storage:write\",\"events:read\",\"events:write\",\"functions:invoke\"]}"
  exh POST "/v1/workspaces/$w/api-keys" "$t" "$w" "{\"keyType\":\"$kt\",\"scopes\":$scopes}" \
    | body_of | python3 -c 'import sys,json;print(json.load(sys.stdin).get("key",""))' 2>/dev/null
}
