#!/usr/bin/env bash
# =============================================================================
# backup.sh — export the LIVE Vault state before a Vault -> OpenBao migration.
#
# Part of the replace-vault-with-openbao change. Operator-run, READ-ONLY against
# the existing Vault. Captures everything migrate.sh needs to copy + everything
# rollback.sh needs to restore, into ./backup/ (NEVER committed — see .gitignore).
#
# It exports:
#   (A) the 7 platform/app KV paths read by ESO:
#       secret/platform/{postgresql,documentdb,kafka,s3,encryption}
#       secret/gateway/apisix, secret/iam/keycloak
#   (B) every live per-tenant function secret under
#       secret/data/falcone/workspace-secrets/** (tenant/workspace/name, depth 3)
#   (C) the rendered release manifest + values + history (helm get ...)
#   (D) the Vault server TLS Secret (so rollback can restore trust)
#   plus backup/MANIFEST.txt with a per-file sha256 + counts so migrate.sh can VERIFY.
#
# SECURITY: secret VALUES are written ONLY to files under ./backup/ (operator-owned,
# gitignored). Values are NEVER echoed to stdout/stderr or logs. The unseal keys /
# root token are operator-held (the init Job never persists them) — you supply a
# read-capable VAULT_TOKEN at runtime; it is not stored.
#
# Usage (run from this directory):
#   export VAULT_ADDR="https://vault.secret-store.svc.cluster.local:8200"   # or a port-forward
#   export VAULT_TOKEN="<operator token with read on secret/*>"
#   export VAULT_CACERT=/path/to/vault-ca.crt          # self-signed CA (or VAULT_SKIP_VERIFY=true)
#   RELEASE=falcone NAMESPACE=falcone ./backup.sh
#
# Requires: vault (CLI), kubectl, helm, jq, sha256sum.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backup}"
RELEASE="${RELEASE:-falcone}"
NAMESPACE="${NAMESPACE:-falcone}"
SECRET_STORE_NS="${SECRET_STORE_NS:-secret-store}"
KV_MOUNT="${KV_MOUNT:-secret}"
VAULT_TLS_SECRET="${VAULT_TLS_SECRET:-vault-server-tls}"
WS_ROOT="falcone/workspace-secrets"

log()  { printf '%s %s\n' "[backup]" "$*"; }
die()  { printf '%s %s\n' "[backup][FATAL]" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

need vault; need jq; need sha256sum
: "${VAULT_ADDR:?set VAULT_ADDR (the live Vault address)}"
: "${VAULT_TOKEN:?set VAULT_TOKEN (an operator token with read on secret/*)}"
export VAULT_ADDR VAULT_TOKEN
[ -n "${VAULT_CACERT:-}" ] && export VAULT_CACERT
[ -n "${VAULT_SKIP_VERIFY:-}" ] && export VAULT_SKIP_VERIFY

mkdir -p "$BACKUP_DIR/kv/platform" "$BACKUP_DIR/kv/gateway" "$BACKUP_DIR/kv/iam" \
         "$BACKUP_DIR/kv/workspace-secrets" "$BACKUP_DIR/manifests"
MANIFEST="$BACKUP_DIR/MANIFEST.txt"
: > "$MANIFEST"

# Confirm we can reach Vault and it is unsealed before doing anything destructive-adjacent.
if ! vault status >/dev/null 2>&1; then
  die "cannot reach Vault at $VAULT_ADDR (sealed/unreachable/auth?). Check VAULT_ADDR/VAULT_TOKEN/VAULT_CACERT."
fi
log "connected to Vault at $VAULT_ADDR (mount=$KV_MOUNT)"

count=0
record() { # $1 = relative file path under backup/ ; appends "<sha256>  <path>" to MANIFEST
  local rel="$1"
  printf '%s  %s\n' "$(sha256sum "$BACKUP_DIR/$rel" | awk '{print $1}')" "$rel" >> "$MANIFEST"
  count=$((count + 1))
}

# --- (A) fixed platform/app paths ------------------------------------------
# logical KV path -> backup file (relative). We read each explicitly (the set is fixed
# and known), so a partially-populated Vault still produces a deterministic backup.
dump_one() { # $1 = logical path (e.g. platform/postgresql) ; $2 = backup rel file
  local path="$1" rel="$2"
  if vault kv get -mount="$KV_MOUNT" -format=json "$path" > "$BACKUP_DIR/$rel.tmp" 2>/dev/null; then
    # keep only data.data (the KV v2 secret map) + data.metadata.version for verification.
    jq '{data: .data.data, version: (.data.metadata.version // null)}' \
      "$BACKUP_DIR/$rel.tmp" > "$BACKUP_DIR/$rel"
    rm -f "$BACKUP_DIR/$rel.tmp"
    record "$rel"
    log "exported $KV_MOUNT/$path"
  else
    rm -f "$BACKUP_DIR/$rel.tmp"
    log "WARN: $KV_MOUNT/$path absent — skipped (not all installs seed every path)"
  fi
}

for name in postgresql documentdb kafka s3 encryption; do
  dump_one "platform/$name" "kv/platform/$name.json"
done
dump_one "gateway/apisix" "kv/gateway/apisix.json"
dump_one "iam/keycloak"   "kv/iam/keycloak.json"

# --- (B) per-tenant/per-workspace function secrets (recursive, depth 3) -----
# Walk WS_ROOT/<tenant>/<workspace>/<name> using KV v2 metadata listing.
list_kv() { vault kv list -mount="$KV_MOUNT" -format=json "$1" 2>/dev/null | jq -r '.[]?' || true; }

log "enumerating $KV_MOUNT/$WS_ROOT/** (tenant/workspace/name)"
for tenant in $(list_kv "$WS_ROOT"); do
  tenant="${tenant%/}"
  for ws in $(list_kv "$WS_ROOT/$tenant"); do
    ws="${ws%/}"
    for nm in $(list_kv "$WS_ROOT/$tenant/$ws"); do
      # leaves only (skip nested folders, which KV lists with a trailing slash)
      case "$nm" in */) continue ;; esac
      mkdir -p "$BACKUP_DIR/kv/workspace-secrets/$tenant/$ws"
      rel="kv/workspace-secrets/$tenant/$ws/$nm.json"
      if vault kv get -mount="$KV_MOUNT" -format=json "$WS_ROOT/$tenant/$ws/$nm" > "$BACKUP_DIR/$rel.tmp" 2>/dev/null; then
        jq '{data: .data.data, version: (.data.metadata.version // null)}' \
          "$BACKUP_DIR/$rel.tmp" > "$BACKUP_DIR/$rel"
        rm -f "$BACKUP_DIR/$rel.tmp"
        record "$rel"
      else
        rm -f "$BACKUP_DIR/$rel.tmp"
      fi
    done
  done
done
log "exported workspace-secret leaves so far (cumulative file count): $count"

# --- (C) rendered manifests + values + history -----------------------------
if command -v helm >/dev/null 2>&1; then
  helm get manifest "$RELEASE" -n "$NAMESPACE" > "$BACKUP_DIR/manifests/release.yaml" 2>/dev/null \
    && record "manifests/release.yaml" || log "WARN: helm get manifest failed (release not found?)"
  helm get values "$RELEASE" -n "$NAMESPACE" > "$BACKUP_DIR/manifests/values.yaml" 2>/dev/null \
    && record "manifests/values.yaml" || log "WARN: helm get values failed"
  helm history "$RELEASE" -n "$NAMESPACE" > "$BACKUP_DIR/manifests/history.txt" 2>/dev/null \
    && record "manifests/history.txt" || log "WARN: helm history failed"
else
  log "WARN: helm not found — skipping manifest/values/history snapshot"
fi

# --- (D) Vault server TLS Secret (for rollback trust restore) --------------
if command -v kubectl >/dev/null 2>&1; then
  if kubectl -n "$SECRET_STORE_NS" get secret "$VAULT_TLS_SECRET" -o yaml \
       > "$BACKUP_DIR/manifests/$VAULT_TLS_SECRET.yaml" 2>/dev/null; then
    record "manifests/$VAULT_TLS_SECRET.yaml"
    log "captured TLS secret $VAULT_TLS_SECRET (for rollback)"
  else
    log "WARN: could not read secret $VAULT_TLS_SECRET in ns $SECRET_STORE_NS"
  fi
else
  log "WARN: kubectl not found — skipping TLS-secret snapshot"
fi

# --- summary ---------------------------------------------------------------
{
  echo "# replace-vault-with-openbao — backup MANIFEST"
  echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# source VAULT_ADDR: $VAULT_ADDR  mount: $KV_MOUNT  release: $RELEASE  ns: $NAMESPACE"
  echo "# total captured files: $count"
  echo "# format below: <sha256>  <relative-path>"
} | cat - "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

kv_total=$(grep -c '  kv/' "$MANIFEST" || true)
log "DONE. captured $count files ($kv_total KV paths) -> $BACKUP_DIR"
log "MANIFEST: $MANIFEST"
log "NEXT: review counts, then run ./migrate.sh against the OpenBao instance."
