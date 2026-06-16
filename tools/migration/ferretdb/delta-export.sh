#!/usr/bin/env bash
# delta-export.sh — re-export documents changed since the initial copy (add-ferretdb-data-migration-
# runbook #461, T04.1). Runs INSIDE the write-freeze window. For collections that carry an update-time
# field it `mongodump --query`s only documents modified at/after --since-timestamp; collections without
# that field are re-exported in full (idempotent `_id` upserts make a full re-export safe regardless).
# The output dump is then applied by upsert.sh.
#
# NOT `mongodump --oplog` / `mongorestore --oplogReplay`: oplog replay needs atomic multi-doc apply,
# which is unsupported on FerretDB (commitTransaction -> CommandNotFound 59) and will not converge.
#
#   delta-export.sh --source-uri <uri> --since-timestamp <ISO8601> --output-dir <dir> --dbs <all|csv> [--update-field <field>]
set -euo pipefail

SOURCE_URI="" SINCE="" OUTPUT_DIR="" DBS="all" UPDATE_FIELD="updatedAt"
while [ $# -gt 0 ]; do
  case "$1" in
    --source-uri)     SOURCE_URI="$2"; shift 2;;
    --since-timestamp) SINCE="$2"; shift 2;;
    --output-dir)     OUTPUT_DIR="$2"; shift 2;;
    --dbs)            DBS="$2"; shift 2;;
    --update-field)   UPDATE_FIELD="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$SOURCE_URI" ] && [ -n "$SINCE" ] && [ -n "$OUTPUT_DIR" ] || { echo "usage: delta-export.sh --source-uri <uri> --since-timestamp <ISO> --output-dir <dir> --dbs <all|csv> [--update-field <f>]" >&2; exit 2; }
command -v mongodump >/dev/null || { echo "mongodump not found on PATH" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

mkdir -p "$OUTPUT_DIR"
# Resolve the database list.
if [ "$DBS" = "all" ]; then
  mapfile -t DBLIST < <(mongosh "$SOURCE_URI" --quiet --eval 'db.adminCommand({listDatabases:1}).databases.map(d=>d.name).filter(n=>!["admin","local","config"].includes(n)).forEach(n=>print(n))')
else
  IFS=',' read -ra DBLIST <<< "$DBS"
fi

QUERY="{\"${UPDATE_FIELD}\":{\"\$gte\":{\"\$date\":\"${SINCE}\"}}}"
for db in "${DBLIST[@]}"; do
  db="$(echo "$db" | tr -d '[:space:]')"; [ -n "$db" ] || continue
  # collections in this db
  mapfile -t COLLS < <(mongosh "$SOURCE_URI/$db" --quiet --eval 'db.getCollectionNames().forEach(c=>print(c))')
  for coll in "${COLLS[@]}"; do
    coll="$(echo "$coll" | tr -d '[:space:]')"; [ -n "$coll" ] || continue
    # Does a document in this collection carry the update-time field?
    HAS_FIELD="$(mongosh "$SOURCE_URI/$db" --quiet --eval "print(db.getCollection('${coll}').findOne({ '${UPDATE_FIELD}': { \$exists: true } }) ? 'yes' : 'no')")"
    if [ "$HAS_FIELD" = "yes" ]; then
      echo ">> [$db.$coll] delta re-export (${UPDATE_FIELD} >= ${SINCE})"
      mongodump --uri "$SOURCE_URI" --db "$db" --collection "$coll" --query "$QUERY" --out "$OUTPUT_DIR"
    else
      echo ">> [$db.$coll] no '${UPDATE_FIELD}' field — full re-export (idempotent upsert is safe)"
      mongodump --uri "$SOURCE_URI" --db "$db" --collection "$coll" --out "$OUTPUT_DIR"
    fi
  done
done
echo ">> delta-export complete -> $OUTPUT_DIR ($(find "$OUTPUT_DIR" -name '*.bson' | wc -l) collection dump(s))"
