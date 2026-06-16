#!/usr/bin/env bash
# migrate.sh — MongoDB -> FerretDB migration entry point (add-ferretdb-data-migration-runbook #461,
# T03.4). Sequences the correct steps for each mode and records pre/post integrity snapshots.
#
#   --mode initial : pre-snapshot(source) -> bulk-copy -> upsert -> export+recreate indexes -> post-snapshot(target)
#   --mode delta   : delta-export(since) -> upsert -> recreate indexes -> post-snapshot(target)   (run inside the write-freeze)
#
# Usage:
#   migrate.sh --mode initial|delta --source-uri <mongo> --dest-uri <ferretdb> --dbs <all|csv> \
#              [--output-dir <dir>] [--snapshot-dir <dir>] [--since-timestamp <ISO> (delta)] [--update-field <f>]
#
# Idempotent: every apply step is a per-document `replaceOne({_id}, …, {upsert:true})`. NO transactional
# batch apply, NO `--oplogReplay` (unsupported on FerretDB — see RUNBOOK.md).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="" SOURCE_URI="" DEST_URI="" DBS="all" OUTPUT_DIR="./migration-dump" SNAP_DIR="./migration-snapshots" SINCE="" UPDATE_FIELD="updatedAt"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)            MODE="$2"; shift 2;;
    --source-uri)      SOURCE_URI="$2"; shift 2;;
    --dest-uri)        DEST_URI="$2"; shift 2;;
    --dbs)             DBS="$2"; shift 2;;
    --output-dir)      OUTPUT_DIR="$2"; shift 2;;
    --snapshot-dir)    SNAP_DIR="$2"; shift 2;;
    --since-timestamp) SINCE="$2"; shift 2;;
    --update-field)    UPDATE_FIELD="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
case "$MODE" in initial|delta) :;; *) echo "usage: migrate.sh --mode initial|delta --source-uri <uri> --dest-uri <uri> --dbs <all|csv> [...]" >&2; exit 2;; esac
[ -n "$SOURCE_URI" ] && [ -n "$DEST_URI" ] || { echo "--source-uri and --dest-uri are required" >&2; exit 2; }
[ "$MODE" = "delta" ] && [ -z "$SINCE" ] && { echo "--since-timestamp is required for --mode delta" >&2; exit 2; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUTPUT_DIR" "$SNAP_DIR"
DUMP="$OUTPUT_DIR/$MODE-$TS"; mkdir -p "$DUMP"

echo "==== migrate.sh --mode $MODE (dbs=$DBS) @ $TS ===="

if [ "$MODE" = "initial" ]; then
  echo "==> [1/5] pre-copy integrity snapshot (source)"
  "$HERE/snapshot.sh"      --uri "$SOURCE_URI" --dbs "$DBS" --output-file "$SNAP_DIR/pre-$TS.json"
  echo "==> [2/5] bulk copy (mongodump snapshot)"
  "$HERE/bulk-copy.sh"     --source-uri "$SOURCE_URI" --dbs "$DBS" --output-dir "$DUMP"
  echo "==> [3/5] idempotent _id upsert into FerretDB"
  "$HERE/upsert.sh"        --dest-uri "$DEST_URI" --dump-dir "$DUMP"
else
  echo "==> [1/5] delta re-export (write-freeze; ${UPDATE_FIELD} >= ${SINCE})"
  "$HERE/delta-export.sh"  --source-uri "$SOURCE_URI" --since-timestamp "$SINCE" --output-dir "$DUMP" --dbs "$DBS" --update-field "$UPDATE_FIELD"
  echo "==> [2/5] idempotent _id upsert into FerretDB"
  "$HERE/upsert.sh"        --dest-uri "$DEST_URI" --dump-dir "$DUMP"
fi

echo "==> [4/5] index export (source) + recreate (FerretDB)"
"$HERE/export-indexes.sh"   --uri "$SOURCE_URI" --dbs "$DBS" --output-file "$DUMP/indexes.json"
"$HERE/recreate-indexes.sh" --dest-uri "$DEST_URI" --index-file "$DUMP/indexes.json"

echo "==> [5/5] post-$MODE integrity snapshot (target)"
"$HERE/snapshot.sh"         --uri "$DEST_URI" --dbs "$DBS" --output-file "$SNAP_DIR/post-$TS.json"

echo "==== migrate.sh --mode $MODE complete. Snapshots: $SNAP_DIR/{pre,post}-*.json ===="
echo "     Verify parity:  $HERE/compare-snapshots.sh --source $SNAP_DIR/pre-<ts>.json --target $SNAP_DIR/post-$TS.json"
