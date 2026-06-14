#!/usr/bin/env bash
# Integrity snapshot capture for the SeaweedFS data migration
# (change add-seaweedfs-data-migration-runbook, task 3.1).
#
# Writes a machine-readable JSON snapshot of every configured bucket:
#   [ { "bucket": "...", "objectCount": N,
#       "objects": [ { "key": "...", "etag": "...", "size": N }, ... ] } ]
# Objects are sorted by key so two snapshots diff deterministically.
#
#   AWS_ACCESS_KEY_ID=.. AWS_SECRET_ACCESS_KEY=.. \
#     ./snapshot.sh --endpoint http://minio:9000 --buckets all --output-file pre.json
#
# Requires: aws, jq.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_s3lib.sh
. "$HERE/_s3lib.sh"

ENDPOINT="" BUCKETS="all" OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --endpoint) ENDPOINT="$2"; shift 2;;
    --buckets) BUCKETS="$2"; shift 2;;
    --output-file) OUT="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$ENDPOINT" ] || { echo "FATAL: --endpoint required" >&2; exit 2; }
[ -n "$OUT" ] || { echo "FATAL: --output-file required" >&2; exit 2; }

tmp="$(mktemp)"
echo "[]" > "$tmp"
while IFS= read -r bucket; do
  [ -n "$bucket" ] || continue
  # list-objects-v2 auto-paginates in aws CLI v2; normalise ETag (strip quotes),
  # sort objects by key for deterministic diffs.
  objects="$(s3api "$ENDPOINT" list-objects-v2 --bucket "$bucket" --output json \
    | jq '[(.Contents // [])[] | {key: .Key, etag: (.ETag | gsub("\""; "")), size: .Size}] | sort_by(.key)')"
  count="$(echo "$objects" | jq 'length')"
  jq --arg b "$bucket" --argjson objs "$objects" --argjson n "$count" \
    '. += [{bucket: $b, objectCount: $n, objects: $objs}]' "$tmp" > "$tmp.next" && mv "$tmp.next" "$tmp"
  echo "  snapshot: $bucket -> $count objects" >&2
done < <(resolve_buckets "$ENDPOINT" "$BUCKETS")

mkdir -p "$(dirname "$OUT")"
jq 'sort_by(.bucket)' "$tmp" > "$OUT"
rm -f "$tmp"
echo "wrote snapshot: $OUT" >&2
