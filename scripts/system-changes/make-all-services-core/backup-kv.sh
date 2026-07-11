#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

OUTPUT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) OUTPUT="${2:?missing --output value}"; shift 2 ;;
    *) echo "usage: $0 --output /secure/path/backup.tgz" >&2; exit 2 ;;
  esac
done
: "${OUTPUT:?--output is required}"

[ ! -e "$OUTPUT" ] || { echo "refusing to overwrite existing backup archive: $OUTPUT" >&2; exit 2; }
require_base_tools
require_helm

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/kv" "$tmp/kubernetes" "$tmp/helm" "$tmp/eso" "$tmp/pvc"

echo "backing up Kubernetes Secrets in namespace $NS"
kubectl -n "$NS" get secrets -o json > "$tmp/kubernetes/secrets.raw.json"
sanitize_kubernetes_list < "$tmp/kubernetes/secrets.raw.json" > "$tmp/kubernetes/secrets.apply.json"
chmod 0400 "$tmp/kubernetes/secrets.raw.json" "$tmp/kubernetes/secrets.apply.json"
write_secret_checksums "$tmp/kubernetes/secret-checksums.tsv"

echo "backing up Helm release $RELEASE in namespace $NS"
helm -n "$NS" get values "$RELEASE" --all -o yaml > "$tmp/helm/values.yaml"
helm -n "$NS" get manifest "$RELEASE" > "$tmp/helm/manifest.yaml"
helm -n "$NS" history "$RELEASE" -o json > "$tmp/helm/history.json"
helm -n "$NS" status "$RELEASE" -o json > "$tmp/helm/status.json"
chmod 0400 "$tmp/helm/"*

echo "backing up ESO resources"
capture_kubectl_json "$tmp/eso/externalsecrets.json" -n "$NS" get externalsecret.external-secrets.io
capture_kubectl_json "$tmp/eso/secretstores.json" -n "$NS" get secretstore.external-secrets.io
capture_kubectl_json "$tmp/eso/clustersecretstores.json" get clustersecretstore.external-secrets.io
sanitize_kubernetes_list < "$tmp/eso/externalsecrets.json" > "$tmp/eso/externalsecrets.apply.json" || cp "$tmp/eso/externalsecrets.json" "$tmp/eso/externalsecrets.apply.json"
sanitize_kubernetes_list < "$tmp/eso/secretstores.json" > "$tmp/eso/secretstores.apply.json" || cp "$tmp/eso/secretstores.json" "$tmp/eso/secretstores.apply.json"
sanitize_kubernetes_list < "$tmp/eso/clustersecretstores.json" > "$tmp/eso/clustersecretstores.apply.json" || cp "$tmp/eso/clustersecretstores.json" "$tmp/eso/clustersecretstores.apply.json"
chmod 0400 "$tmp/eso/"*

echo "backing up PVC inventory"
capture_kubectl_json "$tmp/pvc/release-namespace-pvcs.json" -n "$NS" get pvc
capture_kubectl_json "$tmp/pvc/openbao-namespace-pvcs.json" -n "$OPENBAO_NAMESPACE" get pvc

target_kv_captured=false
if [ -n "${BAO_ADDR:-}" ] || [ -n "${BAO_TOKEN:-}" ]; then
  require_bao
  echo "backing up target OpenBao KV-v2 tree"
  backup_kv_paths "$tmp/kv"
  target_kv_captured=true
else
  echo "target OpenBao not supplied; recording target KV as absent"
  printf '{"absent":true,"reason":"target OpenBao not supplied before rollout","path":"%s"}\n' "$KV_MOUNT" > "$tmp/kv/target-openbao.absent.json"
  chmod 0400 "$tmp/kv/target-openbao.absent.json"
fi

if [ -n "${SOURCE_BAO_ADDR:-}" ] || [ -n "${SOURCE_BAO_TOKEN:-}" ]; then
  echo "backing up external Vault/OpenBao KV-v2 tree"
  backup_source_kv_paths "$tmp/source-kv"
fi

helm_revision="$(jq -r '.version // empty' "$tmp/helm/status.json")"
cat > "$tmp/manifest.json" <<JSON
{"backupVersion":$BACKUP_VERSION,"verified":true,"namespace":"$NS","release":"$RELEASE","helmRevision":"$helm_revision","openbaoNamespace":"$OPENBAO_NAMESPACE","kvMount":"$KV_MOUNT","targetKvCaptured":$target_kv_captured,"sourceKvMount":"$SOURCE_KV_MOUNT","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
verify_extracted_backup "$tmp"
archive_paths=(manifest.json kv kubernetes helm eso pvc)
if [ -d "$tmp/source-kv" ]; then
  archive_paths+=(source-kv)
fi
tar -C "$tmp" -czf "$OUTPUT" "${archive_paths[@]}"
chmod 0600 "$OUTPUT"
echo "backup archive written: $OUTPUT"
echo "archive contains secret material, Helm manifests, and recovery material; store it as a restricted operator artifact"
