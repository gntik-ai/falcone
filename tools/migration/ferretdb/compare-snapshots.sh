#!/usr/bin/env bash
# compare-snapshots.sh — diff two integrity snapshots (add-ferretdb-data-migration-runbook #461,
# T06.4). Compares documentCount and checksum per (db, collection) between a source and a target
# snapshot, reports every divergence with expected vs observed, and exits non-zero on any mismatch
# (including collections present in one snapshot but not the other).
#
#   compare-snapshots.sh --source <source-snapshot.json> --target <target-snapshot.json>
set -euo pipefail

SRC="" TGT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SRC="$2"; shift 2;;
    --target) TGT="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -f "$SRC" ] && [ -f "$TGT" ] || { echo "usage: compare-snapshots.sh --source <a.json> --target <b.json>" >&2; exit 2; }
command -v mongosh >/dev/null || { echo "mongosh not found on PATH" >&2; exit 2; }

SCRIPT="$(mktemp --suffix=.js)"; trap 'rm -f "$SCRIPT"' EXIT
{ printf 'const SRC_FILE = "%s"; const TGT_FILE = "%s";\n' "$SRC" "$TGT"; cat <<'JS'
const fs = require('fs');
const load = (f) => { const a = JSON.parse(fs.readFileSync(f, 'utf8')); const m = new Map(); for (const e of a) m.set(e.db + '.' + e.collection, e); return m; };
const src = load(SRC_FILE), tgt = load(TGT_FILE);
const keys = new Set([...src.keys(), ...tgt.keys()]);
let mismatches = 0;
for (const k of [...keys].sort()) {
  const s = src.get(k), t = tgt.get(k);
  if (!s) { print('MISMATCH ' + k + ': present in target, MISSING in source'); mismatches++; continue; }
  if (!t) { print('MISMATCH ' + k + ': present in source, MISSING in target'); mismatches++; continue; }
  if (s.documentCount !== t.documentCount) { print('MISMATCH ' + k + ': documentCount expected=' + s.documentCount + ' observed=' + t.documentCount); mismatches++; }
  if (s.checksum !== t.checksum) { print('MISMATCH ' + k + ': checksum expected=' + s.checksum.slice(0, 16) + '… observed=' + t.checksum.slice(0, 16) + '…'); mismatches++; }
  if (s.documentCount === t.documentCount && s.checksum === t.checksum) print('OK ' + k + ' (count=' + s.documentCount + ', checksum match)');
}
print('>> compare-snapshots: ' + (keys.size - mismatches) + '/' + keys.size + ' collection(s) match');
if (mismatches > 0) quit(1);
JS
} > "$SCRIPT"

mongosh --nodb --quiet --file "$SCRIPT"
