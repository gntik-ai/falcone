#!/usr/bin/env bash
set -euo pipefail
set +x

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

BACKUP=""
MODE="--dry-run"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) BACKUP="${2:?missing --backup value}"; shift 2 ;;
    --dry-run|--apply) MODE="$1"; shift ;;
    *) echo "usage: $0 --backup /secure/path/backup.tgz [--dry-run|--apply]" >&2; exit 2 ;;
  esac
done
: "${BACKUP:?--backup is required}"

require_base_tools
require_bao

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
tar -C "$tmp" -xzf "$BACKUP"

find "$tmp/kv" -type f -name '*.json' | sort | while read -r file; do
  rel="${file#$tmp/kv/}"
  path="${rel%.json}"
  if jq -e '.absent == true' "$file" >/dev/null 2>&1; then
    echo "skip absent backup marker $KV_MOUNT/$path"
    continue
  fi
  props="$(jq -r '.data.data | keys[]' "$file")"
  echo "restore candidate $KV_MOUNT/$path ($(printf '%s\n' "$props" | sed '/^$/d' | wc -l | tr -d ' ') properties)"
  [ "$MODE" = "--apply" ] || continue
  args=()
  while read -r property; do
    [ -n "$property" ] || continue
    value_file="$tmp/${path//\//_}.${property}"
    jq -jer --arg property "$property" '.data.data[$property]' "$file" > "$value_file"
    chmod 0400 "$value_file"
    args+=("$property" "$value_file")
  done <<<"$props"
  write_grouped_kv "$path" "$tmp" "${args[@]}"
done

[ "$MODE" = "--apply" ] && echo "restore applied; run parity-check.sh --strict before rolling workloads" || echo "dry-run only: no OpenBao writes performed"
