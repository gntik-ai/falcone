#!/usr/bin/env bash
set -euo pipefail
set +x

NS="${NAMESPACE:-falcone}"
RELEASE="${RELEASE:-falcone}"
OPENBAO_NAMESPACE="${OPENBAO_NAMESPACE:-secret-store}"
KV_MOUNT="${BAO_KV_MOUNT:-secret}"
SOURCE_KV_MOUNT="${SOURCE_BAO_KV_MOUNT:-$KV_MOUNT}"
BACKUP_VERSION=3

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

require_test_cluster_write_guard() {
  local expected="${TEST_CLUSTER_CONTEXT:-}"
  local confirm="${CONFIRM_TEST_CLUSTER:-}"
  local phrase="apply-to-explicit-test-cluster"
  [ -n "$expected" ] || {
    echo "refusing write: TEST_CLUSTER_CONTEXT must name the exact test kubectl context" >&2
    exit 2
  }
  local current
  current="$(kubectl config current-context 2>/dev/null || true)"
  [ "$current" = "$expected" ] || {
    echo "refusing write: current kubectl context '$current' does not match TEST_CLUSTER_CONTEXT '$expected'" >&2
    exit 2
  }
  [ "$confirm" = "$phrase" ] || {
    echo "refusing write: set CONFIRM_TEST_CLUSTER=$phrase after verifying this is the test cluster" >&2
    exit 2
  }
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

verify_scoped_clustersecretstores() {
  local input="$1"
  jq -e \
    --arg release "$RELEASE" \
    --arg namespace "$NS" \
    --arg openbao_namespace "$OPENBAO_NAMESPACE" '
      def store_items:
        if .absent == true then []
        elif (.items | type) == "array" then .items
        else [.]
        end;
      .absent == true or (
        (store_items | length) <= 1
        and all(store_items[]; (
          .kind == "ClusterSecretStore"
          and .metadata.name == "openbao-backend"
          and .metadata.annotations["meta.helm.sh/release-name"] == $release
          and .metadata.annotations["meta.helm.sh/release-namespace"] == $namespace
          and .metadata.labels["app.kubernetes.io/instance"] == $release
          and .metadata.labels["app.kubernetes.io/part-of"] == "in-falcone"
          and ((.spec.provider.vault.server // "") | startswith("https://openbao." + $openbao_namespace + ".svc"))
        ))
      )
    ' "$input" >/dev/null || {
      echo "refusing ClusterSecretStore backup/restore outside Falcone-owned openbao-backend for release=$RELEASE namespace=$NS openbaoNamespace=$OPENBAO_NAMESPACE" >&2
      return 1
    }
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

put_kv_data_json() {
  local path="$1" data_json="$2"
  bao kv put "$KV_MOUNT/$path" "@${data_json}" >/dev/null
}

read_target_kv_data_or_empty() {
  local path="$1" output="$2" work_prefix="$3"
  if bao kv get -format=json "$KV_MOUNT/$path" > "$work_prefix.raw.json" 2> "$work_prefix.stderr"; then
    jq '.data.data // {}' "$work_prefix.raw.json" > "$output"
  elif grep -Eq '(^|[[:space:]])No value found at ' "$work_prefix.stderr"; then
    printf '{}\n' > "$output"
  else
    printf 'failed to read target OpenBao KV path %q; refusing to treat the read error as an absent path\n' \
      "$KV_MOUNT/$path" >&2
    return 1
  fi
  rm -f "$work_prefix.raw.json" "$work_prefix.stderr"
}

merge_kv_data_json_into_target() {
  local path="$1" incoming_json="$2" tmp="$3"
  local merge_dir="$tmp/kv-json-merge/${path//\//_}"
  local existing="$merge_dir/existing.json"
  local merged="$merge_dir/merged.json"
  mkdir -p "$merge_dir"
  read_target_kv_data_or_empty "$path" "$existing" "$merge_dir/read"
  jq -s '.[0] + .[1]' "$existing" "$incoming_json" > "$merged"
  chmod 0400 "$merged"
  put_kv_data_json "$path" "$merged"
}

preflight_kv_tree_conflicts() {
  local tree_dir="$1" tmp="$2" output="$3"
  : > "$output"
  kv_tree_has_objects "$tree_dir" || return 0
  find "$tree_dir/objects" -type f -name '*.json' | sort | while IFS= read -r entry; do
    local path compare_dir incoming existing
    path="$(jq -r '.path' "$entry")"
    compare_dir="$tmp/tree-preflight/${path//\//_}"
    incoming="$compare_dir/incoming.json"
    existing="$compare_dir/existing.json"
    mkdir -p "$compare_dir"
    jq '.raw.data.data // {}' "$entry" > "$incoming"
    read_target_kv_data_or_empty "$path" "$existing" "$compare_dir/read"
    chmod 0400 "$incoming" "$existing"

    jq -c 'keys[]' "$incoming" | while IFS= read -r property_json; do
      local property source_hash target_hash status
      property="$(jq -r '.' <<<"$property_json")"
      source_hash="$(jq -cS --argjson property "$property_json" '.[$property]' "$incoming" | fingerprint)"
      if ! jq -e --argjson property "$property_json" 'has($property)' "$existing" >/dev/null; then
        status="missing"
        target_hash="-"
      elif jq -e --argjson property "$property_json" --slurpfile source "$incoming" \
        '.[$property] == $source[0][$property]' "$existing" >/dev/null; then
        status="match"
        target_hash="$source_hash"
      else
        status="conflict"
        target_hash="$(jq -cS --argjson property "$property_json" '.[$property]' "$existing" | fingerprint)"
      fi
      jq -cn \
        --arg path "$path" \
        --arg property "$property" \
        --arg status "$status" \
        --arg sourceSha256 "$source_hash" \
        --arg targetSha256 "$target_hash" \
        '{path:$path, property:$property, status:$status, sourceSha256:$sourceSha256, targetSha256:$targetSha256}' \
        >> "$output"
    done
  done
  chmod 0400 "$output"
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
  local merge_dir="$tmp/kv-merge/${path//\//_}"
  local existing="$merge_dir/existing.json"
  local merged="$merge_dir/merged.json"
  mkdir -p "$merge_dir/files"
  read_target_kv_data_or_empty "$path" "$existing" "$merge_dir/read"
  cp "$existing" "$merged"
  while [ "$#" -gt 0 ]; do
    local property="$1" file="$2"
    local next="$merge_dir/next.json"
    jq --arg property "$property" --rawfile value "$file" '. + {($property): $value}' "$merged" > "$next"
    mv "$next" "$merged"
    shift 2
  done
  chmod 0400 "$merged"
  put_kv_data_json "$path" "$merged"
}

merge_kv_backup_json() {
  local path="$1" backup_json="$2" tmp="$3"
  if jq -e '.absent == true' "$backup_json" >/dev/null 2>&1; then
    return 0
  fi
  local merge_dir="$tmp/source-merge/${path//\//_}"
  local incoming="$merge_dir/incoming.json"
  mkdir -p "$merge_dir"
  jq '.data.data // {}' "$backup_json" > "$incoming"
  chmod 0400 "$incoming"
  merge_kv_data_json_into_target "$path" "$incoming" "$tmp"
}

bao_with_env() {
  local env_name="$1"
  shift
  local -n bao_env_ref="$env_name"
  if [ "${#bao_env_ref[@]}" -gt 0 ]; then
    env "${bao_env_ref[@]}" bao "$@"
  else
    bao "$@"
  fi
}

kv_tree_has_objects() {
  local tree_dir="$1"
  [ -d "$tree_dir/objects" ] && find "$tree_dir/objects" -type f -name '*.json' -print -quit | grep -q .
}

kv_tree_is_captured() {
  local tree_dir="$1"
  [ -f "$tree_dir/_tree.json" ]
}

kv_tree_paths() {
  local tree_dir="$1"
  kv_tree_has_objects "$tree_dir" || return 0
  find "$tree_dir/objects" -type f -name '*.json' -print0 \
    | sort -z \
    | xargs -0 -r jq -r '.path' \
    | sort -u
}

kv2_tree_list_paths() {
  local mount="$1" env_name="$2" prefix="${3:-}"
  local target
  if [ -n "$prefix" ]; then
    target="$mount/$prefix"
  else
    target="$mount/"
  fi
  local listing error_file
  error_file="$(mktemp)"
  if ! listing="$(bao_with_env "$env_name" kv list -format=json "$target" 2>"$error_file")"; then
    if grep -Eq '(^|[[:space:]])No value found at ' "$error_file"; then
      rm -f "$error_file"
      return 0
    fi
    rm -f "$error_file"
    printf 'failed to list OpenBao KV path %q; refusing to record a partial tree\n' "$target" >&2
    return 1
  fi
  rm -f "$error_file"
  local entries_file
  entries_file="$(mktemp)"
  if ! jq -r 'if type == "array" then .[] else error("KV list response is not an array") end' \
    <<<"$listing" > "$entries_file"; then
    rm -f "$entries_file"
    printf 'invalid OpenBao KV list response for path %q; refusing to record a partial tree\n' "$target" >&2
    return 1
  fi
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    if [[ "$entry" == */ ]]; then
      if ! kv2_tree_list_paths "$mount" "$env_name" "${prefix}${entry}"; then
        rm -f "$entries_file"
        return 1
      fi
    else
      printf '%s\n' "${prefix}${entry}"
    fi
  done < "$entries_file"
  rm -f "$entries_file"
}

kv2_export_tree() {
  local out_dir="$1" mount="$2" env_name="$3" label="$4"
  mkdir -p "$out_dir/objects"
  local index="$out_dir/index.tsv"
  : > "$index"
  jq -n --arg mount "$mount" --arg label "$label" --arg kvVersion "v2" \
    '{format:"falcone-openbao-kv-tree", kvVersion:$kvVersion, mount:$mount, label:$label}' \
    > "$out_dir/_tree.json"
  local paths_file="$out_dir/paths.txt"
  if ! kv2_tree_list_paths "$mount" "$env_name" "" > "$paths_file"; then
    return 1
  fi
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    local hash raw object
    hash="$(printf '%s' "$path" | sha256sum | awk '{print $1}')"
    raw="$out_dir/objects/${hash}.raw.json"
    object="$out_dir/objects/${hash}.json"
    if ! bao_with_env "$env_name" kv get -format=json "$mount/$path" > "$raw" 2>"$raw.stderr"; then
      rm -f "$raw"
      rm -f "$raw.stderr"
      printf 'failed to read listed %s KV path %q; refusing to record a partial tree\n' \
        "$label" "$mount/$path" >&2
      return 1
    fi
    rm -f "$raw.stderr"
    jq -n --arg mount "$mount" --arg path "$path" --arg kvVersion "v2" --slurpfile raw "$raw" \
      '{format:"falcone-openbao-kv-entry", kvVersion:$kvVersion, mount:$mount, path:$path, raw:$raw[0]}' \
      > "$object"
    rm -f "$raw"
    chmod 0400 "$object"
    printf '%s\t%s\n' "$hash" "$path" >> "$index"
    echo "backed up $label $mount/$path"
  done < "$paths_file"
  rm -f "$paths_file"
  chmod 0400 "$out_dir/_tree.json" "$index"
}

write_kv_json_exact() {
  local path="$1" entry_json="$2" tmp="$3"
  local merge_dir="$tmp/kv-exact/${path//\//_}"
  local data_file="$merge_dir/data.json"
  mkdir -p "$merge_dir"
  jq '.raw.data.data // {}' "$entry_json" > "$data_file"
  chmod 0400 "$data_file"
  put_kv_data_json "$path" "$data_file"
}

merge_kv_tree_into_target() {
  local tree_dir="$1" tmp="$2"
  kv_tree_has_objects "$tree_dir" || return 0
  find "$tree_dir/objects" -type f -name '*.json' | sort | while IFS= read -r entry; do
    local path merge_dir incoming
    path="$(jq -r '.path' "$entry")"
    merge_dir="$tmp/tree-merge/${path//\//_}"
    incoming="$merge_dir/incoming.json"
    mkdir -p "$merge_dir"
    jq '.raw.data.data // {}' "$entry" > "$incoming"
    chmod 0400 "$incoming"
    merge_kv_data_json_into_target "$path" "$incoming" "$tmp"
  done
}

restore_kv_tree_exact() {
  local tree_dir="$1" tmp="$2"
  kv_tree_is_captured "$tree_dir" || {
    echo "backup has no target OpenBao KV tree; skipping OpenBao KV restore"
    return 0
  }
  local empty_bao_env=()
  local backup_paths="$tmp/backup-kv-paths.txt"
  local current_paths="$tmp/current-kv-paths.txt"
  local listed_paths="$tmp/current-kv-paths.unsorted.txt"
  kv_tree_paths "$tree_dir" > "$backup_paths"
  if ! kv2_tree_list_paths "$KV_MOUNT" empty_bao_env "" > "$listed_paths"; then
    echo "failed to enumerate current target KV paths; exact restore aborted before deletion" >&2
    return 1
  fi
  sort -u "$listed_paths" > "$current_paths"
  comm -13 "$backup_paths" "$current_paths" | while IFS= read -r extra_path; do
    [ -n "$extra_path" ] || continue
    echo "deleting target-only KV path $KV_MOUNT/$extra_path"
    if ! bao kv metadata delete "$KV_MOUNT/$extra_path" >/dev/null 2>&1 &&
       ! bao kv delete "$KV_MOUNT/$extra_path" >/dev/null 2>&1; then
      echo "failed to delete target-only KV path $KV_MOUNT/$extra_path; exact restore aborted" >&2
      return 1
    fi
  done
  find "$tree_dir/objects" -type f -name '*.json' | sort | while IFS= read -r entry; do
    local path
    path="$(jq -r '.path' "$entry")"
    write_kv_json_exact "$path" "$entry" "$tmp"
    echo "restored $KV_MOUNT/$path exactly"
  done
}

backup_kv_paths() {
  local out_dir="$1"
  local empty_bao_env=()
  kv2_export_tree "$out_dir" "$KV_MOUNT" empty_bao_env "target"
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
  kv2_export_tree "$out_dir" "$SOURCE_KV_MOUNT" source_env "external source"
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

backup_captured_target_kv() {
  local dir="$1"
  jq -e '.targetKvCaptured == true' "$dir/manifest.json" >/dev/null
}

require_backup_captured_target_kv_for_overwrite() {
  local dir="$1"
  backup_captured_target_kv "$dir" || {
    echo "refusing --allow-overwrite: verified backup did not capture target OpenBao KV (targetKvCaptured=true required)" >&2
    return 1
  }
}

extract_verified_backup() {
  local backup="$1" dir="$2"
  mkdir -p "$dir"
  tar -C "$dir" -xzf "$backup"
  verify_extracted_backup "$dir"
}
