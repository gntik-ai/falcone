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

require_base_tools
require_bao

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/kv"

platform_mappings_json | jq -r '.[].2' | sort -u | while read -r path; do
  mkdir -p "$tmp/kv/$(dirname "$path")"
  if bao kv get -format=json "$KV_MOUNT/$path" > "$tmp/kv/$path.json" 2>/dev/null; then
    chmod 0400 "$tmp/kv/$path.json"
    echo "backed up $KV_MOUNT/$path"
  else
    echo "missing $KV_MOUNT/$path (recorded as absent)"
    printf '{"absent":true,"path":"%s"}\n' "$path" > "$tmp/kv/$path.json"
  fi
done

cat > "$tmp/manifest.json" <<JSON
{"namespace":"$NS","openbaoNamespace":"$OPENBAO_NAMESPACE","kvMount":"$KV_MOUNT","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
tar -C "$tmp" -czf "$OUTPUT" manifest.json kv
chmod 0600 "$OUTPUT"
echo "backup archive written: $OUTPUT"
echo "archive contains secret material; store it as a restricted operator artifact"
