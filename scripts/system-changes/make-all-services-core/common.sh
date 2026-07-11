#!/usr/bin/env bash
set -euo pipefail
set +x

NS="${NAMESPACE:-falcone}"
OPENBAO_NAMESPACE="${OPENBAO_NAMESPACE:-secret-store}"
KV_MOUNT="${BAO_KV_MOUNT:-secret}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }
}

require_base_tools() {
  need kubectl
  need jq
  need sha256sum
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
