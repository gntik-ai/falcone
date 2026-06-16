#!/usr/bin/env bash
# export-indexes.sh — capture every non-_id index definition from the SOURCE MongoDB
# (add-ferretdb-data-migration-runbook #461, T05.1). Emits a JSON array of full index specs
# (key, name, unique, sparse, expireAfterSeconds, weights, default_language, ... — incl. text and
# 2dsphere) to --output-file, for recreate-indexes.sh to replay onto FerretDB. _id indexes are
# omitted (implicit on every collection).
#
#   export-indexes.sh --uri <mongodb-uri> --dbs <all|db1,db2> --output-file <file>
set -euo pipefail

URI="" DBS="all" OUTPUT_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uri)         URI="$2"; shift 2;;
    --dbs)         DBS="$2"; shift 2;;
    --output-file) OUTPUT_FILE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$URI" ] && [ -n "$OUTPUT_FILE" ] || { echo "usage: export-indexes.sh --uri <uri> --dbs <all|csv> --output-file <file>" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

mkdir -p "$(dirname "$OUTPUT_FILE")"
mongosh "$URI" --quiet --eval "
  const arg = '${DBS}';
  const skip = ['admin','local','config'];
  let dbs = arg === 'all'
    ? db.adminCommand({ listDatabases: 1 }).databases.map(d => d.name).filter(n => !skip.includes(n))
    : arg.split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const dbn of dbs) {
    const d = db.getSiblingDB(dbn);
    for (const c of d.getCollectionNames()) {
      for (const ix of d.getCollection(c).getIndexes()) {
        if (ix.name === '_id_') continue;
        out.push(Object.assign({ db: dbn, collection: c }, ix));
      }
    }
  }
  print(JSON.stringify(out));
" > "$OUTPUT_FILE"
echo ">> exported $(grep -o '\"name\"' "$OUTPUT_FILE" | wc -l) index definition(s) -> $OUTPUT_FILE"
