#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

BACKUP=""
MODE="--dry-run"
HELM_ROLLBACK=0
ROLLBACK_REVISION=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) BACKUP="${2:?missing --backup value}"; shift 2 ;;
    --dry-run|--apply) MODE="$1"; shift ;;
    --helm-rollback) HELM_ROLLBACK=1; shift ;;
    --revision) ROLLBACK_REVISION="${2:?missing --revision value}"; shift 2 ;;
    *) echo "usage: $0 --backup /secure/path/backup.tgz [--dry-run|--apply] [--helm-rollback] [--revision N]" >&2; exit 2 ;;
  esac
done
: "${BACKUP:?--backup is required}"

require_base_tools
require_helm
require_bao

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
extract_verified_backup "$BACKUP" "$tmp/backup"
backup_dir="$tmp/backup"

if [ "$MODE" = "--apply" ]; then
  require_test_cluster_write_guard
fi

echo "restore plan for namespace=$NS release=$RELEASE mode=$MODE"
echo "Kubernetes Secrets: $(jq '.items | length' "$backup_dir/kubernetes/secrets.apply.json") object(s)"
echo "ESO ExternalSecrets: $(jq '.items | length' "$backup_dir/eso/externalsecrets.apply.json" 2>/dev/null || echo 0) object(s)"

if kv_tree_is_captured "$backup_dir/kv"; then
  echo "OpenBao KV restore candidates: $(kv_tree_paths "$backup_dir/kv" | wc -l | tr -d ' ') path(s)"
else
  echo "OpenBao KV restore candidates: target KV was not captured"
fi
[ "$MODE" = "--apply" ] && restore_kv_tree_exact "$backup_dir/kv" "$tmp"

if [ "$MODE" = "--apply" ]; then
  echo "restoring Kubernetes Secrets"
  kubectl -n "$NS" apply -f "$backup_dir/kubernetes/secrets.apply.json" >/dev/null
  if jq -e '.absent != true and (.items | length > 0)' "$backup_dir/eso/externalsecrets.apply.json" >/dev/null 2>&1; then
    echo "restoring namespaced ESO ExternalSecrets"
    kubectl -n "$NS" apply -f "$backup_dir/eso/externalsecrets.apply.json" >/dev/null
  fi
  if jq -e '.absent != true and (.items | length > 0)' "$backup_dir/eso/secretstores.apply.json" >/dev/null 2>&1; then
    echo "restoring namespaced ESO SecretStores"
    kubectl -n "$NS" apply -f "$backup_dir/eso/secretstores.apply.json" >/dev/null
  fi
  if jq -e '.absent != true and (.items | length > 0)' "$backup_dir/eso/clustersecretstores.apply.json" >/dev/null 2>&1; then
    echo "restoring cluster ESO ClusterSecretStores"
    kubectl apply -f "$backup_dir/eso/clustersecretstores.apply.json" >/dev/null
  fi
fi

if [ "$HELM_ROLLBACK" -eq 1 ]; then
  revision="$ROLLBACK_REVISION"
  if [ -z "$revision" ]; then
    revision="$(jq -r '.helmRevision // empty' "$backup_dir/manifest.json")"
  fi
  [ -n "$revision" ] || { echo "no Helm revision in backup; pass --revision N" >&2; exit 1; }
  if [ "$MODE" = "--apply" ]; then
    helm -n "$NS" rollback "$RELEASE" "$revision" --wait --timeout "${HELM_ROLLBACK_TIMEOUT:-15m}"
  else
    echo "dry-run: would run helm -n $NS rollback $RELEASE $revision --wait --timeout ${HELM_ROLLBACK_TIMEOUT:-15m}"
  fi
fi

[ "$MODE" = "--apply" ] && echo "restore applied; run parity-check.sh --strict before rolling workloads" || echo "dry-run only: no OpenBao, Kubernetes Secret, ESO, or Helm rollback changes performed"
