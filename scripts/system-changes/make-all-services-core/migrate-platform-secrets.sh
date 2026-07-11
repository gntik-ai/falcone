#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run) APPLY=0 ;;
  --apply) APPLY=1 ;;
  *) echo "usage: $0 [--dry-run|--apply]" >&2; exit 2 ;;
esac

require_base_tools
require_bao

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "namespace=$NS openbao_namespace=$OPENBAO_NAMESPACE kv_mount=$KV_MOUNT mode=$MODE"
print_mapping_header
platform_mappings_json | jq -cr '.[]' | while read -r row; do
  secret="$(jq -r '.[0]' <<<"$row")"
  secret_key="$(jq -r '.[1]' <<<"$row")"
  path="$(jq -r '.[2]' <<<"$row")"
  property="$(jq -r '.[3]' <<<"$row")"
  print_mapping_fingerprint "$secret" "$secret_key" "$path" "$property"
done

if [ "$APPLY" -ne 1 ]; then
  echo "dry-run only: no OpenBao writes performed"
  exit 0
fi

platform_mappings_json | jq -r '.[].2' | sort -u | while read -r path; do
  mkdir -p "$tmp/$path"
  pairs=()
  while read -r row; do
    secret="$(jq -r '.[0]' <<<"$row")"
    secret_key="$(jq -r '.[1]' <<<"$row")"
    property="$(jq -r '.[3]' <<<"$row")"
    file="$tmp/$path/$property"
    secret_value "$secret" "$secret_key" > "$file"
    chmod 0400 "$file"
    pairs+=("$property" "$file")
  done < <(platform_mappings_json | jq -cr --arg path "$path" '.[] | select(.[2] == $path)')
  write_grouped_kv "$path" "$tmp" "${pairs[@]}"
  echo "wrote $KV_MOUNT/$path ($((${#pairs[@]} / 2)) properties)"
done

echo "OpenBao platform credential migration complete"
