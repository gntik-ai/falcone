#!/usr/bin/env bash
# recreate-indexes.sh — replay exported index definitions onto FerretDB (add-ferretdb-data-migration-
# runbook #461, T05.2/T05.3/T05.4). All index types are recreated; the script NEVER halts on a type.
# Single/compound/unique/sparse/TTL/text/2dsphere are all functional on the pinned pair
# (ferretdb:2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0, rum/postgis bundled — verified).
# A text index's getIndexes() key is internal ({_fts,_ftsx}); it is reconstructed from `weights`.
# Logs PASS/FAIL per index and exits non-zero if any index fails.
#
#   recreate-indexes.sh --dest-uri <ferretdb-uri> --index-file <file>
set -euo pipefail

DEST_URI="" INDEX_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dest-uri)  DEST_URI="$2"; shift 2;;
    --index-file) INDEX_FILE="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$DEST_URI" ] && [ -f "$INDEX_FILE" ] || { echo "usage: recreate-indexes.sh --dest-uri <uri> --index-file <file>" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

# Build a mongosh script (data inlined as a JS literal — avoids all shell quoting issues) and run it.
SCRIPT="$(mktemp --suffix=.js)"; trap 'rm -f "$SCRIPT"' EXIT
{ printf 'const ENTRIES = '; cat "$INDEX_FILE"; printf ';\n'; cat <<'JS'
let failures = 0;
for (const e of ENTRIES) {
  // Drop engine-internal / source-version metadata that FerretDB 2.7.0 rejects: it supports
  // textIndexVersion 2 only (source emits 3) and pins its own 2dsphere version — omitting them lets
  // the engine apply its supported default. `v`/`ns` are not valid createIndex options.
  const { db: dbn, collection, v, ns, textIndexVersion, '2dsphereIndexVersion': _v2d, key, name, weights, ...opts } = e;
  let createKey = key;
  // Reconstruct a text index's user-facing key from its weights ({_fts,_ftsx} is engine-internal).
  if (key && key._fts === 'text' && weights) {
    createKey = {};
    for (const f of Object.keys(weights)) createKey[f] = 'text';
    opts.weights = weights;
  }
  opts.name = name;
  try {
    db.getSiblingDB(dbn).getCollection(collection).createIndex(createKey, opts);
    print('PASS: index ' + name + ' on ' + dbn + '.' + collection);
  } catch (err) {
    failures++;
    print('FAIL: index ' + name + ' on ' + dbn + '.' + collection + ' error=' + (err.codeName || '') + ' ' + (err.message || err));
  }
}
print('>> recreate-indexes: ' + (ENTRIES.length - failures) + '/' + ENTRIES.length + ' index(es) created');
if (failures > 0) quit(1);
JS
} > "$SCRIPT"

mongosh "$DEST_URI" --quiet --file "$SCRIPT"
