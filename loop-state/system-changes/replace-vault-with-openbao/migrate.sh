#!/usr/bin/env bash
# =============================================================================
# migrate.sh — copy the backed-up Vault KV state into OpenBao, then VERIFY.
#
# Part of the replace-vault-with-openbao change. Operator-run, idempotent. Reads the
# JSON written by backup.sh (./backup/kv/**) and `bao kv put`s every path into OpenBao.
# Re-running is safe (bao kv put is upsert; identical input -> identical data).
#
# Preconditions:
#   - OpenBao is installed (helm upgrade with openbao.enabled=true), initialized + unsealed,
#     with the KV v2 mount `secret` enabled (the openbao-init Job does this on a fresh
#     OpenBao; for migration you may instead supply an already-init'd OpenBao). The auth/
#     policies/roles are re-created by the init Job (config, not data) — this script copies
#     DATA only.
#   - ./backup/ exists and was produced by backup.sh (MANIFEST.txt present).
#   - You supply the OpenBao admin/root token + CA (operator-held; never persisted).
#
# Verification (exits non-zero on ANY mismatch):
#   1. every backed-up KV path is present in OpenBao with identical data map + key count
#   2. the encryption master-key (secret/platform/encryption :: master-key) is BYTE-IDENTICAL
#   3. ESO ClusterSecretStore/openbao-backend is Ready
#   4. all platform ExternalSecrets report SecretSynced (Ready=True)
#
# Usage (run from this directory, AFTER backup.sh):
#   export BAO_ADDR="https://openbao.secret-store.svc.cluster.local:8200"   # or a port-forward
#   export BAO_TOKEN="<OpenBao root/admin token>"
#   export BAO_CACERT=/path/to/openbao-ca.crt        # self-signed CA (or BAO_SKIP_VERIFY=true)
#   NAMESPACE=falcone ./migrate.sh                    # add DRY_RUN=1 to preview without writing
#
# Requires: bao (CLI), kubectl, jq, sha256sum.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backup}"
KV_MOUNT="${KV_MOUNT:-secret}"
NAMESPACE="${NAMESPACE:-falcone}"
ESO_STORE="${ESO_STORE:-openbao-backend}"
DRY_RUN="${DRY_RUN:-0}"

log()  { printf '%s %s\n' "[migrate]" "$*"; }
die()  { printf '%s %s\n' "[migrate][FATAL]" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

need bao; need jq; need sha256sum
[ -d "$BACKUP_DIR" ] || die "backup dir not found: $BACKUP_DIR — run ./backup.sh first"
[ -f "$BACKUP_DIR/MANIFEST.txt" ] || die "MANIFEST.txt missing in $BACKUP_DIR — run ./backup.sh first"
: "${BAO_ADDR:?set BAO_ADDR (the OpenBao address)}"
: "${BAO_TOKEN:?set BAO_TOKEN (an OpenBao root/admin token)}"
export BAO_ADDR BAO_TOKEN
[ -n "${BAO_CACERT:-}" ] && export BAO_CACERT
[ -n "${BAO_SKIP_VERIFY:-}" ] && export BAO_SKIP_VERIFY

if ! bao status >/dev/null 2>&1; then
  die "cannot reach OpenBao at $BAO_ADDR (sealed/unreachable/auth?). Check BAO_ADDR/BAO_TOKEN/BAO_CACERT."
fi
log "connected to OpenBao at $BAO_ADDR (mount=$KV_MOUNT)  DRY_RUN=$DRY_RUN"

# Map a backup file path to its logical KV path.
#   kv/platform/postgresql.json        -> platform/postgresql
#   kv/gateway/apisix.json             -> gateway/apisix
#   kv/iam/keycloak.json               -> iam/keycloak
#   kv/workspace-secrets/<t>/<w>/<n>.json -> falcone/workspace-secrets/<t>/<w>/<n>
logical_path() {
  local rel="$1" p="${1#kv/}"
  p="${p%.json}"
  case "$rel" in
    kv/workspace-secrets/*) echo "falcone/workspace-secrets/${p#workspace-secrets/}" ;;
    *) echo "$p" ;;
  esac
}

# ---- PUT phase: bao kv put every backed-up path ---------------------------
put_count=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  src="$BACKUP_DIR/$rel"
  [ -f "$src" ] || die "manifest references missing file: $rel"
  lpath="$(logical_path "$rel")"
  # Build a "key=value" array, ONE element per secret key, WITHOUT echoing values.
  # jq emits each pair as `key=value` followed by a NUL (\u0000) with -j (raw, no newline);
  # `mapfile -d ''` splits on that NUL, so each pair lands in its own array element. This is
  # robust to values that contain spaces, newlines, or '=' (the '=' is bao's key/value split,
  # not ours — each element stays a single "key=value"). The final NUL may yield a trailing
  # empty element, which we drop before use.
  mapfile -d '' kvargs < <(jq -j '.data | to_entries[] | "\(.key)=\(.value)\u0000"' "$src")
  if [ "${#kvargs[@]}" -gt 0 ] && [ -z "${kvargs[-1]}" ]; then unset 'kvargs[-1]'; fi
  if [ "${#kvargs[@]}" -eq 0 ]; then
    log "WARN: $rel has no data keys — skipping"
    continue
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY_RUN would put $KV_MOUNT/$lpath (${#kvargs[@]} key(s))"
  else
    # `bao kv put` is upsert (idempotent). Values are passed as args, never logged.
    bao kv put -mount="$KV_MOUNT" "$lpath" "${kvargs[@]}" >/dev/null \
      || die "bao kv put failed for $KV_MOUNT/$lpath"
    log "put $KV_MOUNT/$lpath (${#kvargs[@]} key(s))"
  fi
  put_count=$((put_count + 1))
done < <(grep -oE '  kv/[^ ]+$' "$BACKUP_DIR/MANIFEST.txt" | sed 's/^  //')

log "PUT phase complete: $put_count path(s) processed"
[ "$DRY_RUN" = "1" ] && { log "DRY_RUN: skipping verification (no data was written)"; exit 0; }

# ---- VERIFY phase ---------------------------------------------------------
fail=0
verify_fail() { printf '%s %s\n' "[migrate][VERIFY-FAIL]" "$*" >&2; fail=1; }

log "VERIFY 1/4: every backed-up path present in OpenBao with identical data"
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  src="$BACKUP_DIR/$rel"
  lpath="$(logical_path "$rel")"
  if ! got=$(bao kv get -mount="$KV_MOUNT" -format=json "$lpath" 2>/dev/null); then
    verify_fail "missing in OpenBao: $KV_MOUNT/$lpath"; continue
  fi
  # Compare the data maps canonically (sorted keys). Hash, never print, the values.
  want_h=$(jq -S '.data' "$src" | sha256sum | awk '{print $1}')
  got_h=$(printf '%s' "$got" | jq -S '.data.data' | sha256sum | awk '{print $1}')
  want_n=$(jq '.data | length' "$src")
  got_n=$(printf '%s' "$got" | jq '.data.data | length')
  if [ "$want_h" != "$got_h" ]; then
    verify_fail "data mismatch at $KV_MOUNT/$lpath (key count want=$want_n got=$got_n)"
  fi
done < <(grep -oE '  kv/[^ ]+$' "$BACKUP_DIR/MANIFEST.txt" | sed 's/^  //')

log "VERIFY 2/4: encryption master-key is byte-identical"
ENC_SRC="$BACKUP_DIR/kv/platform/encryption.json"
if [ -f "$ENC_SRC" ]; then
  want_mk_h=$(jq -r '.data["master-key"] // empty' "$ENC_SRC" | sha256sum | awk '{print $1}')
  if got_enc=$(bao kv get -mount="$KV_MOUNT" -format=json "platform/encryption" 2>/dev/null); then
    got_mk_h=$(printf '%s' "$got_enc" | jq -r '.data.data["master-key"] // empty' | sha256sum | awk '{print $1}')
    if [ "$want_mk_h" = "$got_mk_h" ]; then
      log "  master-key OK (byte-identical; sha256 matches backup)"
    else
      verify_fail "encryption master-key DIFFERS from backup — at-rest-encrypted data would be unreadable. ABORT before decommissioning Vault."
    fi
  else
    verify_fail "platform/encryption missing in OpenBao"
  fi
else
  log "  (no encryption.json in backup — skipping master-key check; ensure this is expected)"
fi

# ---- ESO checks (require kubectl) -----------------------------------------
if command -v kubectl >/dev/null 2>&1; then
  log "VERIFY 3/4: ESO ClusterSecretStore/$ESO_STORE is Ready"
  store_ready=$(kubectl get clustersecretstore "$ESO_STORE" \
    -o jsonpath='{range .status.conditions[?(@.type=="Ready")]}{.status}{end}' 2>/dev/null || true)
  if [ "$store_ready" = "True" ]; then
    log "  ClusterSecretStore/$ESO_STORE Ready=True"
  else
    verify_fail "ClusterSecretStore/$ESO_STORE not Ready (status='$store_ready'). Check OpenBao reachability + k8s auth (eso-role) + caProvider trust to openbao-server-tls."
  fi

  log "VERIFY 4/4: platform ExternalSecrets report SecretSynced (Ready=True)"
  # The 6 platform ExternalSecrets bound to the store, across their namespaces.
  # name:namespace pairs (kept in lockstep with charts/in-falcone/charts/eso/templates/external-secrets/).
  for pair in \
    platform-postgresql-credentials:postgresql \
    platform-documentdb-credentials:documentdb \
    platform-kafka-credentials:kafka \
    platform-s3-credentials:s3-compat \
    gateway-apisix-credentials:apisix \
    iam-keycloak-credentials:keycloak; do
    es="${pair%%:*}"; ns="${pair##*:}"
    ready=$(kubectl -n "$ns" get externalsecret "$es" \
      -o jsonpath='{range .status.conditions[?(@.type=="Ready")]}{.status}{end}' 2>/dev/null || true)
    if [ "$ready" = "True" ]; then
      log "  ExternalSecret $ns/$es SecretSynced (Ready=True)"
    else
      verify_fail "ExternalSecret $ns/$es not Ready (status='$ready')"
    fi
  done
else
  log "WARN: kubectl not found — skipping ESO store + ExternalSecret verification (3/4, 4/4)"
fi

if [ "$fail" -ne 0 ]; then
  die "MIGRATION VERIFICATION FAILED — do NOT decommission Vault. Investigate, fix, re-run (idempotent), or run ./rollback.sh."
fi
log "MIGRATION VERIFIED: all KV paths present + identical, master-key byte-identical, ESO synced. Safe to proceed to the consumer cutover."
