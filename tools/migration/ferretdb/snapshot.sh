#!/usr/bin/env bash
# snapshot.sh — per-collection integrity snapshot (add-ferretdb-data-migration-runbook #461, T06.1).
# For each collection writes {db, collection, documentCount, checksum, indexes:[{name,key,unique}]},
# where `checksum` is sha256 over the documents sorted by `_id`, each canonicalised (keys recursively
# sorted; BSON number wrappers normalised to their numeric value) so the digest is ENGINE-AGNOSTIC —
# a MongoDB source and its FerretDB target produce the same checksum for identical logical data,
# despite int32/int64/double storage differences and field-order differences.
#
#   snapshot.sh --uri <mongodb-uri> --dbs <all|db1,db2> --output-file <file>
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
[ -n "$URI" ] && [ -n "$OUTPUT_FILE" ] || { echo "usage: snapshot.sh --uri <uri> --dbs <all|csv> --output-file <file>" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

mkdir -p "$(dirname "$OUTPUT_FILE")"
SCRIPT="$(mktemp --suffix=.js)"; trap 'rm -f "$SCRIPT"' EXIT
{ printf 'const DBS_ARG = "%s";\n' "$DBS"; cat <<'JS'
const crypto = require('crypto');
const skip = ['admin', 'local', 'config'];
let dbs = DBS_ARG === 'all'
  ? db.adminCommand({ listDatabases: 1 }).databases.map(d => d.name).filter(n => !skip.includes(n))
  : DBS_ARG.split(',').map(s => s.trim()).filter(Boolean);

// Engine-agnostic canonical form: recursively sort keys; normalise BSON numbers to a plain number.
function canon(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canon);
  for (const nk of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    if (Object.prototype.hasOwnProperty.call(v, nk)) return Number(v[nk]);
  }
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
}

const out = [];
for (const dbn of dbs.sort()) {
  const d = db.getSiblingDB(dbn);
  for (const c of d.getCollectionNames().sort()) {
    const coll = d.getCollection(c);
    const h = crypto.createHash('sha256');
    coll.find().sort({ _id: 1 }).forEach(doc => h.update(JSON.stringify(canon(EJSON.serialize(doc)))));
    const indexes = coll.getIndexes()
      .map(ix => ({ name: ix.name, key: ix.key, unique: !!ix.unique }))
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push({ db: dbn, collection: c, documentCount: coll.countDocuments(), checksum: h.digest('hex'), indexes });
  }
}
print(JSON.stringify(out, null, 2));
JS
} > "$SCRIPT"

mongosh "$URI" --quiet --file "$SCRIPT" > "$OUTPUT_FILE"
echo ">> snapshot written: $(grep -c '"collection"' "$OUTPUT_FILE") collection(s) -> $OUTPUT_FILE"
