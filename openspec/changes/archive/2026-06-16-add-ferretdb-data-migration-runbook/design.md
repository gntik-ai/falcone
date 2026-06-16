## Context

Falcone resolves the document-store connection string in
`apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-34):

```js
function mongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
```

The source MongoDB instance is bitnami/mongodb:8.0.0 running as a single-node
replica set. The test environment uses mongo:7 on port 57017 (`--replSet rs0`).
Tenant documents carry a `tenantId` field; the tenant-to-collection mapping is
preserved as-is.

ADR-14 (merged) established the following verified constraints on FerretDB 2.7.0
(`ghcr.io/ferretdb/ferretdb:2.7.0` sha256:5706414241eb… +
`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`
sha256:2386795ec2aa…):

- `commitTransaction` returns CommandNotFound(59); the in-transaction write
  persists without atomicity; `abortTransaction` is a silent no-op (no rollback).
- `watch()` returns CommandNotSupported(115); `changeStreamPreAndPostImages`
  returns UnknownBsonField(40415). Change streams are entirely unsupported.
- Dedicated Postgres engine required; engine must start and become Ready before
  the gateway starts (engine-first startup order).
- Single/compound/unique/sparse/TTL indexes all supported; text and 2dsphere
  are functional (rum/postgis bundled); `$out`/`$merge` blocked by adapter
  allowlist (not an index concern).

These constraints eliminate two strategies that would otherwise seem natural:
transactional batch apply (unsafe — no atomicity) and dual-write with CDC
tailing (impossible — change streams unsupported). The only valid migration
model is maintenance-window write-freeze with idempotent single-document upserts.

## Goals / Non-Goals

**Goals:**

- A scripted idempotent initial bulk copy: `mongodump` snapshot export from
  MongoDB, followed by per-document `_id`-keyed upserts into FerretDB (not
  `mongorestore --drop`, which is non-idempotent; upserts allow safe retry).
- A delta convergence step that runs inside the write-freeze window: re-export
  documents modified since the initial copy (via `mongodump` filtered by
  timestamp), then apply them as idempotent `_id` upserts into FerretDB.
- Index recreation against FerretDB: introspect original MongoDB indexes, drop
  any auto-created FerretDB equivalents for non-`_id` indexes, replay all
  definitions (text and 2dsphere included — both functional on 2.7.0).
- Per-collection integrity verification: document counts, per-collection
  checksums over `_id`-sorted BSON, and index presence.
- A maintenance-window-only cutover runbook with explicit gates and rollback
  hooks; the zero-downtime/dual-write alternative is removed (change streams
  unavailable on FerretDB).
- A prominent notice that realtime/CDC is out of scope for this change.
- A non-prod dry-run requirement with a committed results artifact.

**Non-Goals:**

- Zero-downtime / dual-write migration: requires change-stream tailing, which
  is unsupported on FerretDB (watch returns CommandNotSupported(115)).
- Transactional batch apply: multi-doc transactions are non-atomic on FerretDB
  (commitTransaction returns CommandNotFound(59)).
- Oplog-replay delta convergence (`mongorestore --oplogReplay`): oplog replay
  requires atomic multi-doc apply — unsupported; will not converge. Removed.
- rs.status() / oplog-window assertions (tied to removed oplog-replay path).
- Realtime/CDC remediation (owned by `add-ferretdb-realtime-cdc-remediation`).
- Schema/API compatibility fixes (owned by `add-ferretdb-data-access-cutover`).
- Tenant credential rotation on FerretDB (separate change).
- Automated production cutover — the runbook is operator-driven.
- Application source or chart source modifications.

## Decisions

### D1: Idempotent single-document upserts as the primary data transfer mechanism

Because `commitTransaction` returns CommandNotFound(59) on FerretDB and in-
transaction writes persist without rollback, transactional batch apply is unsafe.
Single-document upserts keyed on `_id` are natively atomic per document in
MongoDB wire protocol and supported on FerretDB. The script runs `replaceOne`
with `upsert:true` for each document, making the procedure re-runnable: a
partial failure leaves FerretDB in a consistent sub-state that can be continued
from where it failed.

Alternative considered: `mongorestore --drop` (full restore, not idempotent) —
rejected because a partial failure on retry would drop already-migrated data,
forcing a full re-run from scratch. Also rejected for delta pass: non-idempotent
on overlap.

### D2: Delta convergence via re-export + idempotent upsert inside the freeze window

After the initial bulk copy, a short write-freeze is applied. During the freeze
the operator re-exports documents modified since the initial copy timestamp
(using `mongodump` with a `--query` filter on an update-time field, or a full
re-export of small collections) and applies them as idempotent `_id` upserts
into FerretDB. Because writes are frozen, no new changes arrive after the
re-export begins, so the target converges exactly to the source at freeze time.

Alternative considered: oplog-replay delta (`mongodump --oplog` /
`mongorestore --oplogReplay`) — explicitly rejected. Oplog replay requires
atomic multi-doc apply. On FerretDB, `commitTransaction` returns
CommandNotFound(59) and `abortTransaction` is a silent no-op. Oplog replay
will not converge. Removed entirely.

Alternative considered: change-stream tailing for zero-downtime dual-write —
explicitly rejected. `watch()` returns CommandNotSupported(115) on FerretDB.
Impossible. Removed entirely.

### D3: Index recreation covers all index types (text and 2dsphere included)

FerretDB 2.7.0 bundles the rum extension (for text search) and postgis (for
2dsphere). Text and 2dsphere indexes are functional. The previous design flagged
them as blockers — this was based on pre-2.7.0 behaviour and is incorrect for
the pinned version pair. The recreation script introspects all non-`_id` indexes
from MongoDB and replays all of them on FerretDB without type-based halting.
The only adapter-level constraint is the `$out`/`$merge` allowlist block, which
applies to aggregation stages, not index types.

### D4: Integrity verification outputs machine-readable JSON

Per-collection snapshots follow the schema
`[{db, collection, documentCount, checksum, indexes: [{name, key, unique}]}]`.
The checksum is sha256 over the concatenated `_id`-sorted BSON hex of all
documents in the collection (via mongosh aggregate + hashString). JSON is chosen
for jq diff-ability and compatibility with the downstream
`add-ferretdb-migration-validation` change.

### D5: Maintenance-window write-freeze is the only valid cutover model

`apps/control-plane/src/runtime/main.mjs::mongoUri` reads `MONGO_URI` once at
process start. The re-point is a single environment variable swap followed by a
pod restart / Helm upgrade. Because change streams are unavailable on FerretDB,
there is no viable mechanism to continuously sync writes from MongoDB to FerretDB
in real time. A write-freeze is the only model that guarantees convergence. The
zero-downtime / dual-write alternative presented in the previous design is removed.

The re-point is NOT a pure single env-var swap: the dedicated engine
(postgres-documentdb) must be running and Ready before the gateway (ferretdb)
starts (engine-first startup order required by ADR-14). The Helm upgrade must
honour this startup dependency.

### D6: Realtime/CDC explicitly out of scope with a prominent notice

The realtime executor and mongo-cdc-bridge rely on MongoDB change streams. Change
streams are unsupported on FerretDB (watch returns CommandNotSupported(115)).
These components are non-functional on FerretDB and are NOT addressed by this
change. The runbook must contain a prominent notice directing operators to
`add-ferretdb-realtime-cdc-remediation` before enabling realtime features
post-cutover.

### D7: Rollback via MONGO_URI revert, not data reversal

If any post-restore validation step fails, the rollback is to revert `MONGO_URI`
to the original MongoDB endpoint (no data moved back required — MongoDB was not
modified during the migration). The runbook references `add-ferretdb-rollback-plan`
for the full rollback procedure including credential cleanup.

## Risks / Trade-offs

[Risk: Freeze window duration grows with dataset size] Mitigation: the initial
bulk copy runs before the freeze; the freeze window covers only the delta re-export
and upsert of documents changed since the initial copy. Dry-run results artifact
provides the empirical baseline for sizing the freeze window.

[Risk: FerretDB upsert throughput slower than batch restore] Mitigation: the
upsert script can be parallelised per collection; the dry-run establishes the
expected throughput.

[Risk: FerretDB document ordering differs from MongoDB on checksum] Mitigation:
documents are sorted by `_id` before checksumming on both sides.

[Risk: Dedicated engine startup order not enforced] Mitigation: the runbook
step for re-pointing includes an explicit readiness gate: verify postgres-documentdb
pod is Ready before starting the FerretDB gateway pod. The Helm upgrade uses
`--wait` with appropriate ordering.

## Migration Plan

1. `add-ferretdb-documentdb-engine` is merged: dedicated postgres-documentdb
   engine is running with engine-first startup confirmed.
2. `add-ferretdb-gateway` is merged: the FerretDB wire-protocol gateway is
   reachable (started after engine).
3. Run initial bulk copy: `mongodump` snapshot from MongoDB; idempotent `_id`
   upsert into FerretDB.
4. Recreate indexes on FerretDB (all types including text and 2dsphere).
5. Execute non-prod dry-run of the full cutover runbook; commit results artifact.
6. At production cutover: enter maintenance window (write-freeze); re-export delta
   documents; apply idempotent upserts; validate; re-point `MONGO_URI` to FerretDB
   (engine-first startup order); exit maintenance window.
7. If validation fails at step 6: revert `MONGO_URI` to MongoDB, refer to
   `add-ferretdb-rollback-plan`. Realtime/CDC remains disabled until
   `add-ferretdb-realtime-cdc-remediation` is applied.

## Open Questions

- OQ1: Should the checksum cover document field order or only canonical BSON?
  (Defer to `add-ferretdb-migration-validation` author — the format is extensible.)
- OQ2: What is the acceptable maintenance-window duration SLA for production?
  (Operator decision; dry-run results artifact provides the empirical baseline.)
- OQ3: For delta re-export on collections without an update-timestamp field, is
  a full re-export + idempotent upsert of the entire collection acceptable?
  (Conservatively yes — idempotent upserts are safe regardless of subset size.)
