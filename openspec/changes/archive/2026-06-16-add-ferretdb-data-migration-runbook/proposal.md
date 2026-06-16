## Why

Falcone's document-store backend is MongoDB (bitnami/mongodb:8.0.0, single-node
replica set; tests/env uses mongo:7 on port 57017). The connection string is
resolved by `apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-34)
from the `MONGO_URI` environment variable. The migration target is
FerretDB/DocumentDB (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`
with `ghcr.io/ferretdb/ferretdb:2.7.0` as the wire-protocol gateway).

ADR-14 (merged) established the verified constraints that govern this runbook:

- **Multi-document transactions are unsupported**: `commitTransaction` returns
  CommandNotFound(59); the in-transaction write persists without atomicity;
  `abortTransaction` is a silent no-op with no rollback. Therefore any
  transactional batch apply during data migration is unsafe.
- **Change streams are unsupported**: `watch()` returns CommandNotSupported(115);
  `changeStreamPreAndPostImages` returns UnknownBsonField(40415). Therefore any
  CDC-based or change-stream-tailed dual-write/zero-downtime sync path cannot run
  against FerretDB.
- **Topology**: a dedicated Postgres engine is required (colocated rejected);
  the engine (postgres-documentdb) must start before the gateway (ferretdb).
- **Index support on 2.7.0**: single/compound/unique/sparse/TTL indexes are all
  supported; text and 2dsphere indexes are functional (the engine bundles rum/postgis).
  The only stage-level constraint is the adapter allowlist blocking `$out`/`$merge`,
  which is not an index concern.

Because FerretDB change streams are unsupported, a zero-downtime dual-write
migration path is impossible. The only valid cutover model is a maintenance-window
write-freeze. Without a scripted, repeatable freeze-and-upsert runbook grounded in
these constraints, the transition cannot be executed safely or rolled back
predictably. GitHub issue #461.

## What Changes

- **NEW** initial bulk-copy script: snapshot export (`mongodump`) from source
  MongoDB, then idempotent single-document upserts keyed on `_id` into FerretDB.
  No transactional batch apply. Re-runnable so partial failures are safe to retry.
- **NEW** delta convergence step: during the write-freeze window, re-export changed
  documents from MongoDB and apply them as idempotent `_id` upserts into FerretDB.
  `mongodump --oplog` / `mongorestore --oplogReplay` are explicitly excluded — oplog
  replay requires atomic multi-doc apply which is unsupported; it will not converge.
- **NEW** index migration step: introspect MongoDB index definitions and recreate
  them on FerretDB. text and 2dsphere indexes are NOT flagged as blockers (both are
  functional on FerretDB 2.7.0). Only `_id` indexes are skipped. Single/compound/
  unique/sparse/TTL all migrate.
- **NEW** integrity verification: per-collection document counts, checksums
  (sha256 over `_id`-sorted document BSON), and index presence checks comparing
  source to target.
- **NEW** cutover runbook (maintenance-window, write-freeze only):
  1. Write-freeze / maintenance-window start (the only valid model).
  2. Final re-export of changed documents from MongoDB since initial copy.
  3. Idempotent `_id` upsert of re-exported documents into FerretDB.
  4. Index recreation on FerretDB.
  5. Validate counts, checksums, and index presence.
  6. Re-point Falcone: update `MONGO_URI` to the FerretDB gateway endpoint;
     apply the dedicated-engine/gateway-first startup order (engine must be
     Ready before gateway); perform the required Helm upgrade / pod restart.
  7. Exit maintenance window / switch traffic.
- **PROMINENT NOTE**: realtime/CDC (realtime-executor + mongo-cdc-bridge) is
  NON-FUNCTIONAL on FerretDB (change streams unsupported) and is explicitly out
  of scope here — owned by `add-ferretdb-realtime-cdc-remediation`.
- Rollback hook references `add-ferretdb-rollback-plan`; validation references
  `add-ferretdb-migration-validation`.
- Infrastructure/ops tooling only — no application source changes.

## Capabilities

### New Capabilities

_(none — this change adds requirements to an existing capability)_

### Modified Capabilities

- `data-api`: ADDED requirements for a verifiable snapshot-export + idempotent
  upsert data-migration procedure (initial bulk copy + freeze-window delta
  convergence), index recreation against FerretDB (all types supported on 2.7.0),
  per-collection integrity verification, a gated maintenance-window cutover runbook
  (zero-downtime/dual-write alternative explicitly removed), dedicated-engine
  topology requirements, and realtime-out-of-scope notice; no existing requirements
  are modified or removed.

## Impact

- **In scope**: deployments where `MONGO_URI` points to MongoDB (bitnami/mongodb:8.0.0
  or compatible) — the standard Helm-installed configuration.
- **Out of scope (explicitly)**: zero-downtime / dual-write migration (requires
  change streams — unsupported on FerretDB); realtime/CDC remediation (owned by
  `add-ferretdb-realtime-cdc-remediation`); schema/feature remediation (owned by
  `add-ferretdb-adr-spike` and `add-ferretdb-data-access-cutover`); tenant
  credential rotation (owned by `add-ferretdb-tenant-isolation-credentials`).
- **Dependencies**: `add-ferretdb-documentdb-engine` (dedicated postgres-documentdb
  engine running, engine-first startup confirmed), `add-ferretdb-gateway` (FerretDB
  wire-protocol gateway reachable, started after engine).
- **Blocks**: `add-ferretdb-migration-validation` (consumes integrity snapshots),
  `add-ferretdb-rollback-plan` (referenced as rollback hook).
- **External tools**: `mongodump` / `mongorestore` >= 100.9 (MongoDB Database Tools)
  for snapshot export; `mongosh` >= 2.0 for index introspection and upsert
  scripting.
- **Epic**: #454.
