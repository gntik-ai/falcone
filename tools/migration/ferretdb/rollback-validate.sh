#!/usr/bin/env bash
# rollback-validate.sh — non-prod rollback validation gate (add-ferretdb-rollback-plan #463,
# tasks 4.1-4.7). MUST be green before the MongoDB decommission step (point-of-no-return).
#
# Runs the MongoDB-side gate (rollback-mongo-check.mjs) against the re-pointed MongoDB endpoint:
#   1. per-tenant data-API smoke (insert/list + cross-tenant denial) through the data-API executor;
#   2. MongoDB change-stream delivery — collection.watch() returns a cursor and an insert is
#      delivered (no CommandNotSupported(115)). This change-stream path only works on MongoDB and
#      is exactly what #460 removed from the post-cutover build, so a green result proves the
#      pre-#460 change-stream image is running against a real MongoDB (NOT FerretDB).
#
# Change-stream delivery is NEVER verified against FerretDB — only against MongoDB after rollback.
#
#   ROLLBACK_MONGO_URI=mongodb://<nonprod-mongodb>/?replicaSet=rs0 \
#     bash tools/migration/ferretdb/rollback-validate.sh
#
#   usage: rollback-validate.sh   (set ROLLBACK_MONGO_URI to the MongoDB endpoint to validate)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${ROLLBACK_MONGO_URI:-}" ]; then
  echo "FATAL: set ROLLBACK_MONGO_URI to the (non-prod) MongoDB endpoint to validate the rollback against." >&2
  echo "usage: ROLLBACK_MONGO_URI=mongodb://<mongodb>/?replicaSet=rs0 bash tools/migration/ferretdb/rollback-validate.sh" >&2
  echo "NOTE: tests/env runs FerretDB (not MongoDB), so this gate is operator-run against the retained MongoDB." >&2
  exit 2
fi

echo "==> Rollback validation gate against MongoDB ($ROLLBACK_MONGO_URI)"
if node "$HERE/rollback-mongo-check.mjs"; then
  echo "GATE: PASS — data-API smoke green AND MongoDB change-stream delivery verified. Decommission step UNBLOCKED."
  echo "      Record environment, date, executor, and the best-effort delta-back acknowledgement in ROLLBACK-RUNBOOK.md."
  exit 0
fi
echo "GATE: FAIL — do NOT proceed to the MongoDB decommission / PVC deletion (point-of-no-return)." >&2
exit 1
