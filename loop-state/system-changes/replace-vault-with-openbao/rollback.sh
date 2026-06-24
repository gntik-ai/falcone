#!/usr/bin/env bash
# =============================================================================
# rollback.sh — revert a Vault -> OpenBao migration to the prior Vault-backed release.
#
# Part of the replace-vault-with-openbao change. Operator-run. Use this if ANY migrate.sh
# verification gate fails (or any rollout gate in RUNBOOK.md), BEFORE Vault is decommissioned.
#
# Because the migration is a parallel cutover (the source Vault is read ONLY during backup/
# migrate, and is decommissioned only as the LAST manual step after every gate passes), the
# original Vault StatefulSet + its PVCs are still intact. Rolling the chart back to the prior
# revision restores the Vault objects, the ESO vault-backend store, and vault.enabled — and the
# Vault data was never mutated. THIS IS LOSSLESS.
#
# Steps:
#   1. helm rollback <release> to the prior (Vault) revision (auto-detected, or set PRIOR_REVISION)
#   2. restore the ORIGINAL control-plane consumer Secrets (in-falcone-vault-workspace-secrets-{env,tls})
#      from backup/manifests/ if they were already swapped to the openbao-named ones
#   3. (optional) delete the partially stood-up OpenBao objects (its PVCs hold only COPIED data —
#      the source-of-truth Vault data is untouched — so deleting them is safe). Gated by DELETE_OPENBAO=1.
#
# DESTRUCTIVE-DEFAULT GUARD: by default this script only performs the helm rollback + consumer-secret
# restore. It NEVER deletes Vault objects/PVCs. It deletes OpenBao objects ONLY when DELETE_OPENBAO=1.
#
# Usage (run from this directory):
#   RELEASE=falcone NAMESPACE=falcone ./rollback.sh
#   # to also tear down the partial OpenBao install:
#   RELEASE=falcone NAMESPACE=falcone DELETE_OPENBAO=1 ./rollback.sh
#   # to pin the target revision explicitly:
#   PRIOR_REVISION=7 RELEASE=falcone NAMESPACE=falcone ./rollback.sh
#
# Requires: helm, kubectl.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backup}"
RELEASE="${RELEASE:-falcone}"
NAMESPACE="${NAMESPACE:-falcone}"
SECRET_STORE_NS="${SECRET_STORE_NS:-secret-store}"
DELETE_OPENBAO="${DELETE_OPENBAO:-0}"

log()  { printf '%s %s\n' "[rollback]" "$*"; }
die()  { printf '%s %s\n' "[rollback][FATAL]" "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

need helm; need kubectl

# --- 1. helm rollback to the prior (Vault) revision ------------------------
if [ -z "${PRIOR_REVISION:-}" ]; then
  # The currently-DEPLOYED revision is the OpenBao one; the prior is the latest superseded.
  PRIOR_REVISION="$(helm history "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null \
    | { command -v jq >/dev/null 2>&1 && jq -r '
          [ .[] | select(.status=="superseded") ] | (sort_by(.revision) | last | .revision) // empty
        ' || sed -n 's/.*"revision":\([0-9]*\).*/\1/p' | tail -2 | head -1; })"
fi
[ -n "${PRIOR_REVISION:-}" ] || die "could not determine the prior revision — pass PRIOR_REVISION=<n> (see: helm history $RELEASE -n $NAMESPACE)"

log "rolling $RELEASE (ns $NAMESPACE) back to revision $PRIOR_REVISION (the Vault-backed chart)"
helm rollback "$RELEASE" "$PRIOR_REVISION" -n "$NAMESPACE" --wait --timeout 10m \
  || die "helm rollback failed — inspect 'helm history $RELEASE -n $NAMESPACE'"
log "helm rollback complete — Vault objects + ESO vault-backend + vault.enabled restored"

# --- 2. restore original consumer Secrets ----------------------------------
# If the consumer was already repointed to the openbao-named Secrets, the rolled-back control-plane
# expects the legacy in-falcone-vault-workspace-secrets-{env,tls}. The chart creates none of these
# (operator-supplied), so re-create them. The env Secret content is operator-held; the TLS CA can be
# restored from the captured vault-server-tls.
ENV_SECRET="in-falcone-vault-workspace-secrets-env"
TLS_SECRET="in-falcone-vault-workspace-secrets-tls"
if kubectl -n "$NAMESPACE" get secret "$ENV_SECRET" >/dev/null 2>&1; then
  log "consumer env Secret $ENV_SECRET already present — leaving as-is"
else
  log "NOTE: re-create the consumer env Secret $ENV_SECRET with the Vault VAULT_ADDR/VAULT_KV_MOUNT/VAULT_TOKEN/NODE_EXTRA_CA_CERTS (operator-held token):"
  log "  kubectl -n $NAMESPACE create secret generic $ENV_SECRET \\"
  log "    --from-literal=VAULT_ADDR=https://vault.$SECRET_STORE_NS.svc.cluster.local:8200 \\"
  log "    --from-literal=VAULT_KV_MOUNT=secret \\"
  log "    --from-literal=NODE_EXTRA_CA_CERTS=/vault/tls/ca.crt \\"
  log "    --from-literal=VAULT_TOKEN=<token-with-write-on-the-kv-mount>"
fi
if kubectl -n "$NAMESPACE" get secret "$TLS_SECRET" >/dev/null 2>&1; then
  log "consumer TLS Secret $TLS_SECRET already present — leaving as-is"
elif [ -f "$BACKUP_DIR/manifests/vault-server-tls.yaml" ]; then
  CA_B64="$(kubectl -n "$SECRET_STORE_NS" get secret vault-server-tls -o jsonpath='{.data.ca\.crt}' 2>/dev/null || true)"
  if [ -n "$CA_B64" ]; then
    kubectl -n "$NAMESPACE" create secret generic "$TLS_SECRET" \
      --from-literal=ca.crt="$(printf '%s' "$CA_B64" | base64 -d)" \
      --dry-run=client -o yaml | kubectl apply -f - \
      && log "restored consumer TLS Secret $TLS_SECRET from the live vault-server-tls CA"
  else
    log "WARN: vault-server-tls CA not readable — restore $TLS_SECRET manually from backup/manifests/vault-server-tls.yaml"
  fi
else
  log "WARN: no captured vault-server-tls — restore $TLS_SECRET manually if the consumer needs it"
fi

# --- 3. (optional) tear down the partial OpenBao install -------------------
if [ "$DELETE_OPENBAO" = "1" ]; then
  log "DELETE_OPENBAO=1 — removing partially stood-up OpenBao objects in ns $SECRET_STORE_NS"
  log "(OpenBao PVCs hold only COPIED data; the source-of-truth Vault data is untouched — safe.)"
  # Workloads + config first, then the (copied-data) PVCs.
  kubectl -n "$SECRET_STORE_NS" delete statefulset openbao --ignore-not-found
  kubectl -n "$SECRET_STORE_NS" delete service openbao openbao-internal --ignore-not-found
  kubectl -n "$SECRET_STORE_NS" delete job openbao-init openbao-migration --ignore-not-found
  kubectl -n "$SECRET_STORE_NS" delete configmap openbao-config \
    openbao-policy-platform openbao-policy-tenant openbao-policy-functions \
    openbao-policy-gateway openbao-policy-iam --ignore-not-found
  kubectl delete clustersecretstore openbao-backend --ignore-not-found
  kubectl -n "$SECRET_STORE_NS" delete secret openbao-server-tls --ignore-not-found
  kubectl -n "$SECRET_STORE_NS" delete pvc openbao-data openbao-audit --ignore-not-found
  log "OpenBao objects removed (Vault remains intact and serving)"
else
  log "OpenBao objects left in place (set DELETE_OPENBAO=1 to remove the partial install)."
fi

log "ROLLBACK COMPLETE. Verify: ESO ClusterSecretStore/vault-backend Ready, the 6 *-credentials Secrets present,"
log "and a control-plane secrets round-trip resolves against Vault. The source Vault was never mutated -> lossless."
log "IMPORTANT: Vault PVCs (vault-data/vault-audit) were NEVER deleted by this script. Decommissioning Vault is a"
log "separate, final, manual gate performed only after the OpenBao cutover is fully verified — never during rollback."
