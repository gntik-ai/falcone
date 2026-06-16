#!/usr/bin/env bash
# Single-entrypoint MongoDB -> FerretDB v2 + DocumentDB migration validation
# (change add-ferretdb-migration-validation, tasks 3b.1, 4.1-4.2, 5.2).
#
# Runs the document-parity checker then the per-tenant document-store-API smoke (incl. the
# risk-area probes and the cross-tenant negative probe) against the tests/env real-stack
# harness, honouring FERRETDB_URI / MONGO_URI. Exits zero only when every check passes or all
# failures are explicit ADR-14 waivers; names the failing check otherwise — so it can gate CI
# and the rollback-plan go/no-go.
#
# DEPENDS ON the FerretDB migration changes:
#   - add-ferretdb-data-access-cutover      (#459 — MONGO_BACKEND=ferretdb data-API; rejects txn 501)
#   - add-ferretdb-realtime-cdc-remediation (#460 — CDC-over-logical-replication remediation tracking)
#   - add-ferretdb-data-migration-runbook   (#461 — the migration manifest snapshot)
# OQ resolutions:
#   OQ1 (task 1.1): the parity manifest is the runbook's post-<ts>.json snapshot — document
#     count + ENGINE-AGNOSTIC content checksum per (db, collection) (NOT ObjectId ranges).
#     Pass it via MIGRATION_MANIFEST; ferretdb-parity-check.mjs reproduces snapshot.sh's digest.
#   OQ2 (task 1.2): the FerretDB gateway listens on host port 57017 — the SAME port as the
#     replaced mongo:7, so it does not collide; FERRETDB_URI / MONGO_URI point there.
#   OQ3 (task 1.5): transaction commit -> CommandNotFound 59; abort is a SILENT NO-OP (no
#     rollback — data-integrity finding); CDC watch -> CommandNotSupported 115;
#     changeStreamPreAndPostImages -> UnknownBsonField 40415 (pinned in
#     ferretdb-smoke-data-api.mjs::ADR14_CODES; a different code is a NEW finding, not a skip).
#
#   FERRETDB_URI=mongodb://falcone:falcone@localhost:57017/ \
#   MIGRATION_MANIFEST=tools/migration/ferretdb/migration-snapshots/post-<ts>.json \
#     bash tests/env/validation/run-ferretdb-validation.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
ENV_DIR="$ROOT/tests/env"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

# Source the harness env for defaults, but the caller wins: CI/operator exports FERRETDB_URI (or
# MONGO_URI) before invoking, and env.sh (whose MONGO_URI still names the pre-cutover replica
# set) must not clobber it. Default to the FerretDB gateway URI when neither is set.
_OV_URI="${FERRETDB_URI:-${MONGO_URI:-}}"
if [ -f "$ENV_DIR/env.sh" ]; then set +u; . "$ENV_DIR/env.sh" >/dev/null 2>&1 || true; set -u; fi
FERRETDB_URI="${_OV_URI:-mongodb://falcone:falcone@localhost:57017/}"
export FERRETDB_URI
export MONGO_URI="$FERRETDB_URI"

# --- Engine-first startup (task 3b.1) -----------------------------------------------
# Start the documentdb engine and WAIT for its healthcheck, THEN start the ferretdb gateway and
# WAIT for the wire protocol to answer. ferretdb depends_on documentdb (service_healthy), so the
# ordering is also enforced by compose; we make it explicit and fail loudly, naming the
# container that did not come up. Set FERRETDB_VALIDATION_NO_COMPOSE=1 to skip (endpoint already up).
if [ "${FERRETDB_VALIDATION_NO_COMPOSE:-}" != "1" ]; then
  echo "==> [engine-first] starting documentdb engine (postgres-documentdb:17-0.107.0-ferretdb-2.7.0) and waiting for health"
  if ! $COMPOSE up -d --wait documentdb; then
    echo "FATAL: documentdb engine failed to become healthy — aborting (FerretDB gateway must NOT start before the engine)." >&2
    exit 3
  fi
  echo "==> [engine-first] starting ferretdb gateway (ferretdb:2.7.0)"
  if ! $COMPOSE up -d ferretdb; then
    echo "FATAL: ferretdb gateway failed to start." >&2
    exit 3
  fi
  echo "==> [engine-first] waiting for the FerretDB gateway wire protocol on $FERRETDB_URI"
  if ! node "$HERE/wait-ferretdb.mjs"; then
    echo "FATAL: ferretdb gateway did not answer a MongoDB ping in time." >&2
    exit 3
  fi
fi

FAIL=0
declare -a SUMMARY=()

echo "==> FerretDB migration validation (FERRETDB_URI=$FERRETDB_URI)"

# 1. Document parity (manifest-driven; live-diff fallback; skip if neither provided).
if [ -n "${MIGRATION_MANIFEST:-}" ]; then
  if node "$HERE/ferretdb-parity-check.mjs" --manifest "$MIGRATION_MANIFEST" ${EXCEPTIONS:+--exceptions "$EXCEPTIONS"}; then
    SUMMARY+=("parity-check: PASS")
  else
    FAIL=1; SUMMARY+=("parity-check: FAIL")
  fi
elif [ -n "${SOURCE_MONGO_URI:-}" ]; then
  if node "$HERE/ferretdb-parity-check.mjs" --live-diff --source-uri "$SOURCE_MONGO_URI"; then
    SUMMARY+=("parity-check (live-diff): PASS")
  else
    FAIL=1; SUMMARY+=("parity-check (live-diff): FAIL")
  fi
else
  SUMMARY+=("parity-check: SKIPPED (set MIGRATION_MANIFEST or SOURCE_MONGO_URI)")
fi

# 2. Per-tenant document-store-API smoke + risk-area probes + cross-tenant negative probe.
#    (Emits its own ADR-14 waiver + finding summary on stderr.)
if node "$HERE/ferretdb-smoke-data-api.mjs"; then
  SUMMARY+=("smoke-data-api: PASS")
else
  FAIL=1; SUMMARY+=("smoke-data-api: FAIL")
fi

echo "---- FerretDB validation summary ----"
for line in "${SUMMARY[@]}"; do echo "  $line"; done
if [ "$FAIL" -eq 0 ]; then echo "VALIDATION: PASS"; exit 0; fi
echo "VALIDATION: FAIL (see the named failing check above)"; exit 1
