#!/usr/bin/env bash
# rollback-delta-back.sh — best-effort reverse sync of writes that landed on FerretDB+DocumentDB
# during the rollback window, back into MongoDB (add-ferretdb-rollback-plan #463, task 3.3).
#
# This is the REVERSE of upsert.sh: source = FerretDB gateway (FERRETDB_URI), dest = MongoDB
# (ROLLBACK_MONGO_URI). For each database it mongodumps from FerretDB, restores into a transient
# `<db>__rollbackstaging` namespace on MongoDB, then issues a `replaceOne({_id}, doc, {upsert:true})`
# for every document into the real `<db>` namespace, then drops the staging db.
#
# BEST-EFFORT — read this before running:
#   FerretDB 2.7.0 has NO change streams (`collection.watch()` -> CommandNotSupported(115)) and NO
#   multi-document transactions (commit -> CommandNotFound(59); abort is a silent no-op), so writes
#   accumulated on FerretDB during the window CANNOT be reverse-synced via oplog/change-stream
#   tailing. This idempotent single-document `_id` UPSERT is the only viable path; ordering and
#   cross-document atomicity are NOT guaranteed. The operator MUST acknowledge this before marking
#   the rollback complete (see ROLLBACK-RUNBOOK.md).
#
#   ROLLBACK_MONGO_URI=mongodb://<mongodb>/ FERRETDB_URI=mongodb://falcone:falcone@<gw>:27017/ \
#     rollback-delta-back.sh --dbs <all|db1,db2> [--ack]
#
#   usage: rollback-delta-back.sh --dbs <all|csv> [--ack]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DBS="all" ACK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dbs) DBS="$2"; shift 2;;
    --ack) ACK=1; shift;;
    -h|--help) echo "usage: rollback-delta-back.sh --dbs <all|csv> [--ack]" >&2; exit 0;;
    *) echo "unknown arg: $1" >&2; echo "usage: rollback-delta-back.sh --dbs <all|csv> [--ack]" >&2; exit 2;;
  esac
done

SOURCE_URI="${FERRETDB_URI:-${MONGO_URI:-}}"
DEST_URI="${ROLLBACK_MONGO_URI:-}"
[ -n "$SOURCE_URI" ] || { echo "FATAL: set FERRETDB_URI (the FerretDB gateway to read FROM)" >&2; exit 2; }
[ -n "$DEST_URI" ]   || { echo "FATAL: set ROLLBACK_MONGO_URI (the MongoDB to write the delta back INTO)" >&2; exit 2; }
command -v mongodump >/dev/null    || { echo "mongodump (mongodb-database-tools) not found on PATH" >&2; exit 2; }
command -v mongorestore >/dev/null || { echo "mongorestore not found on PATH" >&2; exit 2; }
command -v mongosh >/dev/null      || { echo "mongosh not found on PATH" >&2; exit 2; }

if [ "$ACK" -ne 1 ]; then
  echo "REFUSING: this delta-back sync is BEST-EFFORT (no ordering / no cross-document atomicity)." >&2
  echo "Re-run with --ack to acknowledge the best-effort nature (ROLLBACK-RUNBOOK.md, point-of-no-return)." >&2
  exit 3
fi

DUMP_DIR="$(mktemp -d)"; trap 'rm -rf "$DUMP_DIR"' EXIT
STAGING_SUFFIX="__rollbackstaging"

echo ">> [delta-back] mongodump FROM FerretDB ($SOURCE_URI), dbs=$DBS"
if [ "$DBS" = "all" ]; then
  mongodump --uri "$SOURCE_URI" --out "$DUMP_DIR"
else
  IFS=',' read -ra DBLIST <<< "$DBS"
  for db in "${DBLIST[@]}"; do mongodump --uri "$SOURCE_URI" --db "$db" --out "$DUMP_DIR"; done
fi

for dbpath in "$DUMP_DIR"/*/; do
  [ -d "$dbpath" ] || continue
  db="$(basename "$dbpath")"
  case "$db" in admin|local|config) echo ">> skipping system db '$db'"; continue;; esac
  staging="${db}${STAGING_SUFFIX}"
  echo ">> [$db] restoring FerretDB snapshot DATA into staging '$staging' on MongoDB ..."
  mongosh "$DEST_URI" --quiet --eval "db.getSiblingDB('${staging}').dropDatabase()" >/dev/null
  # DATA ONLY: MongoDB already has the original indexes (it is the retained source); we sync only
  # the documents that changed on FerretDB during the window.
  mongorestore --uri "$DEST_URI" --quiet --noIndexRestore --nsFrom "${db}.*" --nsTo "${staging}.*" "$DUMP_DIR" >/dev/null

  echo ">> [$db] best-effort idempotent _id upsert staging -> '$db' on MongoDB ..."
  mongosh "$DEST_URI" --quiet --eval "
    const staging = db.getSiblingDB('${staging}');
    const target  = db.getSiblingDB('${db}');
    let totalColls = 0, totalDocs = 0;
    for (const c of staging.getCollectionNames()) {
      let n = 0;
      staging.getCollection(c).find().forEach(doc => { target.getCollection(c).replaceOne({ _id: doc._id }, doc, { upsert: true }); n++; });
      print('   PASS upsert ${db}.' + c + ' (' + n + ' docs, count=' + target.getCollection(c).countDocuments() + ')');
      totalColls++; totalDocs += n;
    }
    staging.dropDatabase();
    print('>> [${db}] delta-back upserted ' + totalDocs + ' docs across ' + totalColls + ' collection(s); staging dropped');
  "
done
echo ">> rollback delta-back complete (BEST-EFFORT, idempotent _id upsert; operator acknowledged)"
