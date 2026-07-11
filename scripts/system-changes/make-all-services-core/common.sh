#!/usr/bin/env bash
set -euo pipefail
set +x

NS="${NAMESPACE:-falcone}"
RELEASE="${RELEASE:-falcone}"
OPENBAO_NAMESPACE="${OPENBAO_NAMESPACE:-secret-store}"
KV_MOUNT="${BAO_KV_MOUNT:-secret}"
SOURCE_KV_MOUNT="${SOURCE_BAO_KV_MOUNT:-$KV_MOUNT}"
BACKUP_VERSION=2

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }
}

require_base_tools() {
  need kubectl
  need jq
  need sha256sum
}

require_helm() {
  need helm
}

require_bao() {
  need bao
  : "${BAO_ADDR:?BAO_ADDR is required}"
  : "${BAO_TOKEN:?BAO_TOKEN is required}"
}

fingerprint() {
  sha256sum | awk '{print $1}'
}

secret_value() {
  local secret="$1" key="$2"
  kubectl -n "$NS" get secret "$secret" -o json \
    | jq -er --arg key "$key" '.data[$key] // empty' \
    | base64 -d
}

secret_fingerprint() {
  local secret="$1" key="$2"
  secret_value "$secret" "$key" | fingerprint
}

secret_length() {
  local secret="$1" key="$2"
  secret_value "$secret" "$key" | wc -c | tr -d ' '
}

bao_value() {
  local path="$1" property="$2"
  bao kv get -format=json "$KV_MOUNT/$path" \
    | jq -er --arg property "$property" '.data.data[$property] // empty'
}

bao_fingerprint() {
  local path="$1" property="$2"
  bao_value "$path" "$property" | fingerprint
}

sanitize_kubernetes_list() {
  jq '
    del(.metadata.resourceVersion, .metadata.selfLink, .metadata.uid, .metadata.creationTimestamp, .metadata.managedFields)
    | .items = ((.items // []) | map(
        del(
          .metadata.resourceVersion,
          .metadata.selfLink,
          .metadata.uid,
          .metadata.creationTimestamp,
          .metadata.managedFields,
          .metadata.ownerReferences,
          .status
        )
      ))
  '
}

capture_kubectl_json() {
  local output="$1"
  shift
  if kubectl "$@" -o json > "$output" 2>"$output.stderr"; then
    rm -f "$output.stderr"
  else
    jq -n --arg command "kubectl $*" --rawfile stderr "$output.stderr" \
      '{absent:true, command:$command, stderr:$stderr}' > "$output"
    rm -f "$output.stderr"
  fi
  chmod 0400 "$output"
}

write_secret_checksums() {
  local output="$1"
  : > "$output"
  kubectl -n "$NS" get secrets -o json \
    | jq -r '.items[] | .metadata.name as $name | (.data // {}) | keys[] | [$name, .] | @tsv' \
    | while IFS=$'\t' read -r secret key; do
        local len hash
        len="$(secret_length "$secret" "$key")"
        hash="$(secret_fingerprint "$secret" "$key")"
        printf '%s\t%s\t%s\t%s\t%s\n' "$NS" "$secret" "$key" "$len" "$hash"
      done >> "$output"
  chmod 0400 "$output"
}

print_mapping_header() {
  printf '%-42s %-34s %-14s %s\n' "kubernetes" "openbao" "length" "sha256"
}

print_mapping_fingerprint() {
  local secret="$1" secret_key="$2" path="$3" property="$4"
  local len hash
  len="$(secret_length "$secret" "$secret_key")"
  hash="$(secret_fingerprint "$secret" "$secret_key")"
  printf '%-42s %-34s %-14s %s\n' "${secret}/${secret_key}" "${path}/${property}" "$len" "$hash"
}

platform_mappings_json() {
  cat <<'JSON'
[
  ["in-falcone-postgresql","POSTGRESQL_USERNAME","platform/postgresql","username"],
  ["in-falcone-postgresql","POSTGRESQL_PASSWORD","platform/postgresql","app-password"],
  ["in-falcone-postgresql","POSTGRESQL_POSTGRES_PASSWORD","platform/postgresql","root-password"],
  ["in-falcone-postgresql-vector","POSTGRES_USER","platform/postgresql-vector","username"],
  ["in-falcone-postgresql-vector","POSTGRES_PASSWORD","platform/postgresql-vector","password"],
  ["in-falcone-postgresql-vector","POSTGRES_DB","platform/postgresql-vector","database"],
  ["in-falcone-documentdb","POSTGRES_USER","platform/documentdb","username"],
  ["in-falcone-documentdb","POSTGRES_PASSWORD","platform/documentdb","password"],
  ["in-falcone-documentdb","POSTGRES_DB","platform/documentdb","database"],
  ["in-falcone-ferretdb","postgresql-url","platform/documentdb","ferretdb-postgresql-url"],
  ["in-falcone-documentdb-replication","password","platform/documentdb-replication","password"],
  ["in-falcone-documentdb-replication","realtime-url","platform/documentdb-replication","realtime-url"],
  ["in-falcone-kafka","KAFKA_CFG_NODE_ID","platform/kafka","node-id"],
  ["in-falcone-kafka","KAFKA_CFG_NODE_ID","platform/kafka","KAFKA_CFG_NODE_ID"],
  ["in-falcone-kafka","KAFKA_CFG_PROCESS_ROLES","platform/kafka","KAFKA_CFG_PROCESS_ROLES"],
  ["in-falcone-kafka","KAFKA_CFG_CONTROLLER_LISTENER_NAMES","platform/kafka","KAFKA_CFG_CONTROLLER_LISTENER_NAMES"],
  ["in-falcone-kafka","KAFKA_CFG_CONTROLLER_QUORUM_VOTERS","platform/kafka","KAFKA_CFG_CONTROLLER_QUORUM_VOTERS"],
  ["in-falcone-kafka","KAFKA_CFG_LISTENERS","platform/kafka","KAFKA_CFG_LISTENERS"],
  ["in-falcone-kafka","KAFKA_CFG_ADVERTISED_LISTENERS","platform/kafka","KAFKA_CFG_ADVERTISED_LISTENERS"],
  ["in-falcone-kafka","KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP","platform/kafka","KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP"],
  ["in-falcone-storage","s3_access_key","platform/s3","access-key"],
  ["in-falcone-storage","s3_secret_key","platform/s3","secret-key"],
  ["in-falcone-temporal","username","platform/temporal","username"],
  ["in-falcone-temporal","password","platform/temporal","password"],
  ["in-falcone-temporal","database","platform/temporal","database"],
  ["in-falcone-temporal","visibility-database","platform/temporal","visibility-database"],
  ["in-falcone-encryption","master-key","platform/encryption","master-key"],
  ["in-falcone-apisix-admin","admin-key","gateway/apisix","admin-key"],
  ["in-falcone-gateway-shared-secret","secret","gateway/shared","secret"],
  ["in-falcone-keycloak-admin","username","iam/keycloak","admin-username"],
  ["in-falcone-keycloak-admin","password","iam/keycloak","admin-password"],
  ["in-falcone-postgresql","POSTGRESQL_PASSWORD","iam/keycloak","db-password"],
  ["in-falcone-identity-client","client-id","iam/identity-client","client-id"],
  ["in-falcone-identity-client","client-secret","iam/identity-client","client-secret"],
  ["in-falcone-superadmin","password","iam/superadmin","password"]
]
JSON
}

write_grouped_kv() {
  local path="$1" tmp="$2"
  shift 2
  local args=()
  while [ "$#" -gt 0 ]; do
    local property="$1" file="$2"
    args+=("${property}=@${file}")
    shift 2
  done
  bao kv put "$KV_MOUNT/$path" "${args[@]}" >/dev/null
}

backup_kv_paths() {
  local out_dir="$1"
  mkdir -p "$out_dir"
  platform_mappings_json | jq -r '.[].2' | sort -u | while read -r path; do
    mkdir -p "$out_dir/$(dirname "$path")"
    if bao kv get -format=json "$KV_MOUNT/$path" > "$out_dir/$path.json" 2>/dev/null; then
      chmod 0400 "$out_dir/$path.json"
      echo "backed up $KV_MOUNT/$path"
    else
      echo "missing $KV_MOUNT/$path (recorded as absent)"
      printf '{"absent":true,"path":"%s"}\n' "$path" > "$out_dir/$path.json"
      chmod 0400 "$out_dir/$path.json"
    fi
  done
}

backup_source_kv_paths() {
  local out_dir="$1"
  : "${SOURCE_BAO_ADDR:?SOURCE_BAO_ADDR is required when backing up an external source}"
  : "${SOURCE_BAO_TOKEN:?SOURCE_BAO_TOKEN is required when backing up an external source}"
  mkdir -p "$out_dir"
  local source_env=("BAO_ADDR=$SOURCE_BAO_ADDR" "BAO_TOKEN=$SOURCE_BAO_TOKEN")
  if [ -n "${SOURCE_BAO_CACERT:-}" ]; then
    source_env+=("BAO_CACERT=$SOURCE_BAO_CACERT")
  fi
  platform_mappings_json | jq -r '.[].2' | sort -u | while read -r path; do
    mkdir -p "$out_dir/$(dirname "$path")"
    if env "${source_env[@]}" bao kv get -format=json "$SOURCE_KV_MOUNT/$path" > "$out_dir/$path.json" 2>/dev/null; then
      chmod 0400 "$out_dir/$path.json"
      echo "backed up external $SOURCE_KV_MOUNT/$path"
    else
      echo "missing external $SOURCE_KV_MOUNT/$path (recorded as absent)"
      printf '{"absent":true,"path":"%s"}\n' "$path" > "$out_dir/$path.json"
      chmod 0400 "$out_dir/$path.json"
    fi
  done
}

verify_extracted_backup() {
  local dir="$1"
  [ -f "$dir/manifest.json" ] || { echo "backup manifest.json missing" >&2; return 1; }
  jq -e --arg ns "$NS" --arg release "$RELEASE" --argjson minVersion "$BACKUP_VERSION" '
    (.backupVersion >= $minVersion)
    and (.verified == true)
    and (.namespace == $ns)
    and (.release == $release)
  ' "$dir/manifest.json" >/dev/null || {
    echo "backup manifest does not match namespace=$NS release=$RELEASE or is not verified" >&2
    return 1
  }
  [ -f "$dir/kubernetes/secrets.apply.json" ] || { echo "backup missing kubernetes/secrets.apply.json" >&2; return 1; }
  [ -f "$dir/kubernetes/secret-checksums.tsv" ] || { echo "backup missing kubernetes/secret-checksums.tsv" >&2; return 1; }
  [ -f "$dir/helm/values.yaml" ] || { echo "backup missing helm/values.yaml" >&2; return 1; }
  [ -f "$dir/helm/manifest.yaml" ] || { echo "backup missing helm/manifest.yaml" >&2; return 1; }
  [ -d "$dir/kv" ] || { echo "backup missing kv/" >&2; return 1; }
}

extract_verified_backup() {
  local backup="$1" dir="$2"
  mkdir -p "$dir"
  tar -C "$dir" -xzf "$backup"
  verify_extracted_backup "$dir"
}
