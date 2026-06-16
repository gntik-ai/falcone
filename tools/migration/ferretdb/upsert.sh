#!/usr/bin/env bash
# upsert.sh — idempotent apply of a mongodump snapshot into FerretDB (add-ferretdb-data-migration-
# runbook #461, T03.2/T03.3). For each database in the dump dir it restores into a transient
# `<db>__migstaging` namespace on the target, then issues a `replaceOne({_id}, doc, {upsert:true})`
# for every document into the real `<db>` namespace, then drops the staging db.
#
# WHY staging+upsert (not `mongorestore --drop` / `--oplogReplay`): a plain mongorestore INSERTs and
# fails on duplicate _id (not re-runnable); `--oplogReplay` needs atomic multi-doc apply, which is
# unsupported on FerretDB (commitTransaction -> CommandNotFound 59). replaceOne+upsert keyed on _id
# is idempotent and single-document — safe to re-run after a partial failure. Verified against
# ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0.
#
#   upsert.sh --dest-uri <ferretdb-uri> --dump-dir <dir>
set -euo pipefail

DEST_URI="" DUMP_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dest-uri) DEST_URI="$2"; shift 2;;
    --dump-dir) DUMP_DIR="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$DEST_URI" ] && [ -d "$DUMP_DIR" ] || { echo "usage: upsert.sh --dest-uri <uri> --dump-dir <dir>" >&2; exit 2; }
command -v mongorestore >/dev/null || { echo "mongorestore not found on PATH" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

STAGING_SUFFIX="__migstaging"
for dbpath in "$DUMP_DIR"/*/; do
  [ -d "$dbpath" ] || continue
  db="$(basename "$dbpath")"
  case "$db" in admin|local|config) echo ">> skipping system db '$db'"; continue;; esac
  staging="${db}${STAGING_SUFFIX}"
  echo ">> [$db] restoring snapshot DATA into staging '$staging' ..."
  # Drop any stale staging (e.g. from a previous interrupted run) so the restore is clean.
  mongosh "$DEST_URI" --quiet --eval "db.getSiblingDB('${staging}').dropDatabase()" >/dev/null
  # DATA ONLY (--noIndexRestore): indexes are migrated separately by export/recreate-indexes.sh.
  # The dump's index metadata can carry textIndexVersion:3 / 2dsphereIndexVersion:3, which FerretDB
  # 2.7.0 rejects (supports text v2 only) — restoring indexes here would fail the whole restore.
  mongorestore --uri "$DEST_URI" --quiet --noIndexRestore --nsFrom "${db}.*" --nsTo "${staging}.*" "$DUMP_DIR" >/dev/null

  echo ">> [$db] idempotent _id upsert staging -> '$db' ..."
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
    print('>> [${db}] upserted ' + totalDocs + ' docs across ' + totalColls + ' collection(s); staging dropped');
  "
done
echo ">> upsert complete (idempotent)"
