#!/usr/bin/env bash
# Single-entrypoint SeaweedFS migration validation
# (change add-seaweedfs-migration-validation, tasks 4.1-4.2).
#
# Runs the object-parity checker then the per-tenant storage-API smoke
# (incl. the cross-tenant negative probe) against the tests/env real-stack
# harness, honouring S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY. Exits zero only
# when every check passes; names the failing check otherwise — so it can gate CI
# and the rollback-plan go/no-go.
#
# Depends on the SeaweedFS migration changes: add-seaweedfs-storage-provider,
# add-seaweedfs-bucket-lifecycle-migration, add-seaweedfs-data-migration-runbook.
# OQ resolutions: OQ1 — the migration manifest uses ETag (snapshot format from the
# data-migration runbook); OQ2 — point S3_ENDPOINT at the SeaweedFS gateway (e.g.
# :58333) so it does not collide with the MinIO harness port :59000.
#
#   S3_ENDPOINT=http://localhost:58333 S3_ACCESS_KEY=.. S3_SECRET_KEY=.. \
#   MIGRATION_MANIFEST=./migration-snapshots/post-<ts>.json \
#     bash tests/env/validation/run-validation.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# Source the harness env for S3_* DEFAULTS, but the caller wins: CI/operator exports
# S3_ENDPOINT (pointing at SeaweedFS) before invoking, and env.sh must not clobber it.
_OV_EP="${S3_ENDPOINT:-}"; _OV_AK="${S3_ACCESS_KEY:-}"; _OV_SK="${S3_SECRET_KEY:-}"
if [ -f "$ROOT/tests/env/env.sh" ]; then
  set +u; . "$ROOT/tests/env/env.sh" >/dev/null 2>&1 || true; set -u
fi
[ -n "$_OV_EP" ] && export S3_ENDPOINT="$_OV_EP"
# Align all four cred aliases so the destination creds are unambiguous (env.sh sets
# both S3_ACCESS_KEY and S3_ACCESS_KEY_ID; the caller's value must win on both).
[ -n "$_OV_AK" ] && export S3_ACCESS_KEY="$_OV_AK" S3_ACCESS_KEY_ID="$_OV_AK"
[ -n "$_OV_SK" ] && export S3_SECRET_KEY="$_OV_SK" S3_SECRET_ACCESS_KEY="$_OV_SK"

FAIL=0
declare -a SUMMARY=()

echo "==> SeaweedFS migration validation (S3_ENDPOINT=${S3_ENDPOINT:-unset})"

# 1. Object parity (manifest-driven; live-diff fallback; skip if neither provided).
if [ -n "${MIGRATION_MANIFEST:-}" ]; then
  if node "$HERE/parity-check.mjs" --manifest "$MIGRATION_MANIFEST" ${EXCEPTIONS:+--exceptions "$EXCEPTIONS"}; then
    SUMMARY+=("parity-check: PASS")
  else
    FAIL=1; SUMMARY+=("parity-check: FAIL")
  fi
elif [ -n "${SOURCE_S3_ENDPOINT:-}" ]; then
  if node "$HERE/parity-check.mjs" --live-diff --source-endpoint "$SOURCE_S3_ENDPOINT"; then
    SUMMARY+=("parity-check (live-diff): PASS")
  else
    FAIL=1; SUMMARY+=("parity-check (live-diff): FAIL")
  fi
else
  SUMMARY+=("parity-check: SKIPPED (set MIGRATION_MANIFEST or SOURCE_S3_ENDPOINT)")
fi

# 2. Per-tenant storage-API smoke + cross-tenant negative probe.
if node "$HERE/smoke-storage.mjs"; then
  SUMMARY+=("smoke-storage: PASS")
else
  FAIL=1; SUMMARY+=("smoke-storage: FAIL")
fi

echo "---- validation summary ----"
for line in "${SUMMARY[@]}"; do echo "  $line"; done
if [ "$FAIL" -eq 0 ]; then echo "VALIDATION: PASS"; exit 0; fi
echo "VALIDATION: FAIL"; exit 1
