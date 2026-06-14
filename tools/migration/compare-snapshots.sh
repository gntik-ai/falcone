#!/usr/bin/env bash
# Snapshot diff for the SeaweedFS data migration
# (change add-seaweedfs-data-migration-runbook, task 3.4).
#
# Compares two snapshot JSON files (see snapshot.sh) per bucket. Reports any
# bucket where object count differs, or any object whose ETag/size differs, or
# keys present in one side only. Exits non-zero on ANY divergence so it can gate
# the cutover runbook and CI.
#
#   ./compare-snapshots.sh pre.json post.json
#
# Requires: jq.
set -euo pipefail
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq not found" >&2; exit 2; }

PRE="${1:-}"; POST="${2:-}"
[ -f "$PRE" ] && [ -f "$POST" ] || { echo "usage: compare-snapshots.sh <pre.json> <post.json>" >&2; exit 2; }

# Build a deterministic divergence report. A "divergence" is: a bucket only on one
# side, an object-count mismatch, or an object whose (etag,size) differs / is
# missing. Output is human-readable on stderr; the diff count drives the exit code.
report="$(jq -n --slurpfile a "$PRE" --slurpfile b "$POST" '
  def index(arr): reduce arr[] as $x ({}; .[$x.bucket] = $x);
  def objindex(o): reduce o[] as $x ({}; .[$x.key] = {etag: $x.etag, size: $x.size});
  ($a[0]) as $pre | ($b[0]) as $post |
  (index($pre)) as $pi | (index($post)) as $pj |
  (($pi | keys) + ($pj | keys) | unique) as $buckets |
  [ $buckets[] as $bk
    | ($pi[$bk]) as $p | ($pj[$bk]) as $q
    | if   $p == null then {bucket:$bk, kind:"bucket-missing-in-pre"}
      elif $q == null then {bucket:$bk, kind:"bucket-missing-in-post"}
      else
        ( objindex($p.objects) ) as $po | ( objindex($q.objects) ) as $qo
        | ( ($po|keys)+($qo|keys) | unique ) as $keys
        | ( [ $keys[] as $k
              | if   $po[$k] == null then {bucket:$bk, key:$k, kind:"key-only-in-post"}
                elif $qo[$k] == null then {bucket:$bk, key:$k, kind:"key-only-in-pre"}
                elif $po[$k] != $qo[$k] then {bucket:$bk, key:$k, kind:"etag-or-size-mismatch", pre:$po[$k], post:$qo[$k]}
                else empty end ] ) as $objdiffs
        | ( if ($p.objectCount != $q.objectCount)
              then [{bucket:$bk, kind:"count-mismatch", pre:$p.objectCount, post:$q.objectCount}] else [] end ) as $countdiff
        | ($countdiff + $objdiffs)[]
      end
  ]')"

n="$(echo "$report" | jq 'length')"
if [ "$n" -eq 0 ]; then
  echo "PASS: snapshots match (counts + ETags identical across all buckets)" >&2
  exit 0
fi
echo "FAIL: $n divergence(s) detected:" >&2
echo "$report" | jq -c '.[]' >&2
exit 1
