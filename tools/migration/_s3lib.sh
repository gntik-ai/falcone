#!/usr/bin/env bash
# Shared S3 helpers for the SeaweedFS data-migration tooling
# (change add-seaweedfs-data-migration-runbook). Source this from the other
# scripts; it standardises path-style addressing (required by MinIO and
# SeaweedFS) and provides thin `s3api`/`s3cli` wrappers over the AWS CLI.
#
# Requires: aws (CLI v2), jq.
# Credentials are read from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# environment variables (set per-endpoint by the caller).

set -euo pipefail

command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found" >&2; exit 2; }
command -v jq  >/dev/null 2>&1 || { echo "FATAL: jq not found" >&2; exit 2; }

# Force path-style addressing + a deterministic multipart threshold for every aws
# invocation (MinIO/SeaweedFS are not virtual-host capable on localhost/IP).
_MIG_AWS_CFG="$(mktemp)"
cat > "$_MIG_AWS_CFG" <<'CFG'
[default]
s3 =
    addressing_style = path
    multipart_threshold = 8MB
CFG
export AWS_CONFIG_FILE="$_MIG_AWS_CFG"
export AWS_PAGER=""
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
export AWS_EC2_METADATA_DISABLED=true
trap 'rm -f "$_MIG_AWS_CFG"' EXIT

# s3api <endpoint> <s3api-args...>   (creds via AWS_ACCESS_KEY_ID/SECRET in env)
s3api() { local ep="$1"; shift; aws --endpoint-url "$ep" s3api "$@"; }
# s3cli <endpoint> <s3-args...>
s3cli() { local ep="$1"; shift; aws --endpoint-url "$ep" s3 "$@"; }

# list_buckets <endpoint> -> bucket names, one per line
list_buckets() { s3api "$1" list-buckets --query 'Buckets[].Name' --output text | tr '\t' '\n' | sed '/^$/d'; }

# resolve_buckets <endpoint> <csv-or-all> -> newline-separated bucket list
resolve_buckets() {
  local ep="$1" spec="$2"
  if [ "$spec" = "all" ]; then list_buckets "$ep"; else echo "$spec" | tr ',' '\n' | sed '/^$/d'; fi
}
