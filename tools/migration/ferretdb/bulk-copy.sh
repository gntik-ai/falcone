#!/usr/bin/env bash
# bulk-copy.sh — snapshot export from the SOURCE MongoDB (add-ferretdb-data-migration-runbook #461,
# T03.1). Runs `mongodump` covering the requested databases into --output-dir. This is the
# point-in-time snapshot that upsert.sh idempotently applies into FerretDB. No transactional apply,
# no --oplog (oplog replay needs atomic multi-doc apply, unsupported on FerretDB — see RUNBOOK.md).
#
#   bulk-copy.sh --source-uri <mongodb-uri> --dbs <all|db1,db2> --output-dir <dir>
set -euo pipefail

SOURCE_URI="" DBS="all" OUTPUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source-uri) SOURCE_URI="$2"; shift 2;;
    --dbs)        DBS="$2"; shift 2;;
    --output-dir) OUTPUT_DIR="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$SOURCE_URI" ] && [ -n "$OUTPUT_DIR" ] || { echo "usage: bulk-copy.sh --source-uri <uri> --dbs <all|csv> --output-dir <dir>" >&2; exit 2; }
command -v mongodump >/dev/null || { echo "mongodump (mongodb-database-tools) not found on PATH" >&2; exit 2; }

mkdir -p "$OUTPUT_DIR"
if [ "$DBS" = "all" ]; then
  echo ">> mongodump ALL databases from source -> $OUTPUT_DIR"
  mongodump --uri "$SOURCE_URI" --out "$OUTPUT_DIR"
else
  IFS=',' read -ra DBLIST <<< "$DBS"
  for db in "${DBLIST[@]}"; do
    echo ">> mongodump database '$db' -> $OUTPUT_DIR"
    mongodump --uri "$SOURCE_URI" --db "$db" --out "$OUTPUT_DIR"
  done
fi
echo ">> bulk-copy snapshot complete: $(find "$OUTPUT_DIR" -name '*.bson' | wc -l) collection dump(s)"
