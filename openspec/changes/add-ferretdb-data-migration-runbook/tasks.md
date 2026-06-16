## Progress — focused start (2026-06-16)

> Core data + index migration scripts built under `tools/migration/ferretdb/` and validated END-TO-END
> against a live source MongoDB (mongo:7) -> FerretDB target (tests/env): `bulk-copy.sh` (mongodump),
> `upsert.sh` (mongorestore into `<db>__migstaging` **DATA-ONLY `--noIndexRestore`** + idempotent
> `replaceOne({_id},doc,{upsert:true})` -> real db -> drop staging; re-run keeps counts stable),
> `export-indexes.sh` + `recreate-indexes.sh` (9/9 incl. text + 2dsphere PASS). **Live premise
> corrections:** (1) `mongorestore` recreates the dump's indexes and FerretDB 2.7.0 rejects
> `textIndexVersion:3` ("only textIndexVersion 2 is supported") -> restore DATA-ONLY; (2) recreate must
> **strip** `textIndexVersion`/`2dsphereIndexVersion` (and a text index's `{_fts,_ftsx}` key is rebuilt
> from `weights`) — the proposal's "all index types functional" holds, but the source version metadata
> must not be passed through. NEXT: preflight.sh, snapshot.sh + compare-snapshots.sh (sha256 integrity),
> delta-export.sh, migrate.sh entry point, RUNBOOK.md, full dry-run results artifact (T02/T04/T06/T07/T08/T09).

## T01: Confirm baseline green

- [ ] T01.1 Run `openspec validate add-ferretdb-data-migration-runbook --strict`
  and confirm it exits zero before beginning any implementation work.
- [ ] T01.2 Confirm `add-ferretdb-documentdb-engine` is merged: dedicated
  postgres-documentdb engine is running with engine-first startup order confirmed.
- [ ] T01.3 Confirm `add-ferretdb-gateway` is merged: FerretDB wire-protocol
  gateway is reachable and started after the engine pod reaches Ready.

## T02: Precondition check script

- [ ] T02.1 Create `tools/migration/ferretdb/preflight.sh` that accepts
  `--engine-pod <name/selector>` and `--ferretdb-uri`; asserts that the
  postgres-documentdb pod is in Ready state before the FerretDB gateway process
  is verified reachable; prints the confirmed version pair
  (ferretdb:2.7.0 / postgres-documentdb:17-0.107.0-ferretdb-2.7.0) and exits
  non-zero with a clear message if either precondition is unmet.
- [ ] T02.2 Integrate `preflight.sh` as step 1 of the cutover runbook so it is
  always the first gate before any data transfer or write-freeze.

## T03: Initial bulk copy script (idempotent upserts)

- [x] T03.1 Create `tools/migration/ferretdb/bulk-copy.sh` that accepts
  `--source-uri` (MongoDB), `--dest-uri` (FerretDB), `--dbs` (comma-separated
  or `all`), and `--output-dir`; runs `mongodump --uri $SOURCE_URI --out
  $output_dir` covering the specified databases.
- [x] T03.2 Create `tools/migration/ferretdb/upsert.sh` that accepts `--dest-uri`
  and `--dump-dir`; for each BSON file in the dump, issues a `replaceOne` with
  `upsert:true` keyed on `_id` for every document via mongosh; logs progress per
  collection; is safe to re-run (idempotent).
- [x] T03.3 Do NOT use `mongorestore --drop` or `mongorestore --oplogReplay` —
  these are non-idempotent or require atomic multi-doc transactions (unsupported
  on FerretDB). Use only `replaceOne + upsert:true` per document.
- [ ] T03.4 Create `tools/migration/ferretdb/migrate.sh` entry point with
  `--mode initial|delta` that sequences the correct steps; `initial` runs
  `mongodump` then `upsert.sh`; `delta` runs a scoped re-export (see T04) then
  `upsert.sh`.

## T04: Delta convergence script (re-export + idempotent upsert inside write-freeze)

- [ ] T04.1 Create `tools/migration/ferretdb/delta-export.sh` that accepts
  `--source-uri`, `--since-timestamp`, `--output-dir`, and `--dbs`; for
  collections that carry an update-time field, uses `mongodump` with a
  `--query` filter to export only documents modified since `--since-timestamp`;
  for collections without an update-time field, performs a full collection
  re-export (idempotent upserts are safe regardless).
- [ ] T04.2 Wire `delta-export.sh` into `migrate.sh --mode delta` followed by
  `upsert.sh`; document that this step runs inside the write-freeze window so
  no new writes arrive after the re-export begins.
- [ ] T04.3 Explicitly document in comments and the runbook that
  `mongodump --oplog` / `mongorestore --oplogReplay` are NOT used: oplog replay
  requires atomic multi-doc apply (non-atomic on FerretDB; commitTransaction
  returns CommandNotFound(59)) and will not converge.

## T05: Index migration script (all types, no type-based halting)

- [x] T05.1 Create `tools/migration/ferretdb/export-indexes.sh` that uses mongosh
  to iterate all collections in the source MongoDB and writes a JSON file
  `{db, collection, indexes: [{name, key, unique, sparse, expireAfterSeconds,
  weights, ...}]}` for every non-`_id` index, including text and 2dsphere entries.
- [x] T05.2 Create `tools/migration/ferretdb/recreate-indexes.sh` that reads the
  exported JSON and runs `db.collection.createIndex(...)` via mongosh against the
  FerretDB target; skips `_id` indexes only; does NOT halt on text or 2dsphere
  index types (both are functional on FerretDB 2.7.0 with rum/postgis bundled).
- [x] T05.3 Log each index creation result as `PASS: index <name> on
  <db>.<collection>` or `FAIL: index <name> on <db>.<collection> error=<msg>`;
  exit non-zero if any index fails.
- [x] T05.4 Remove any prior logic that halted on text or 2dsphere index types —
  these are functional on the pinned version pair and must not block migration.

## T06: Integrity snapshot and comparison

- [ ] T06.1 Create `tools/migration/ferretdb/snapshot.sh` that accepts `--uri`,
  `--dbs`, and `--output-file`; for each collection writes
  `{db, collection, documentCount, checksum, indexes: [{name, key, unique}]}`
  where `checksum` is sha256 over `_id`-sorted document BSON via mongosh.
- [ ] T06.2 Integrate a pre-copy snapshot call (source MongoDB) into `migrate.sh`
  before any data transfer; writes `./migration-snapshots/pre-<timestamp>.json`.
- [ ] T06.3 Integrate a post-delta snapshot call (FerretDB target) into
  `migrate.sh` after the delta upsert step completes; writes
  `./migration-snapshots/post-<timestamp>.json`.
- [ ] T06.4 Create `tools/migration/ferretdb/compare-snapshots.sh` that accepts
  two snapshot files, diffs document counts and checksums per collection, reports
  divergences with expected and observed values, and exits non-zero on any
  mismatch.

## T07: Cutover runbook document (maintenance-window, no dual-write alternative)

- [ ] T07.1 Create `tools/migration/ferretdb/RUNBOOK.md` with the following
  ordered, gated steps; each step contains copy-pasteable shell commands, a gate
  criterion, and a rollback instruction:
  1. Precondition check (`preflight.sh`): dedicated engine Ready, gateway
     reachable, version pair confirmed.
  2. Write-freeze / maintenance-window start.
  3. Delta re-export (`migrate.sh --mode delta --since-timestamp <T0>`).
  4. Idempotent `_id` upsert of re-exported documents into FerretDB (`upsert.sh`).
  5. Index recreation on FerretDB (`recreate-indexes.sh`).
  6. Snapshot comparison (`compare-snapshots.sh`); gate: exit zero (parity
     confirmed).
  7. Re-point Falcone: update `MONGO_URI` to FerretDB gateway endpoint; confirm
     engine-first startup order (postgres-documentdb Ready before ferretdb starts);
     perform Helm upgrade / pod restart.
  8. Exit maintenance window / switch traffic.
- [ ] T07.2 The runbook SHALL NOT contain a zero-downtime / dual-write alternative
  section. Change streams are unsupported on FerretDB (watch returns
  CommandNotSupported(115)); CDC-based dual-write is impossible. This fact must
  be stated explicitly in the runbook introduction.
- [ ] T07.3 Add a PROMINENT NOTICE block at the top of the runbook (e.g., a
  Markdown blockquote or admonition) stating: "Realtime and CDC features
  (realtime-executor, mongo-cdc-bridge) are NON-FUNCTIONAL on FerretDB: MongoDB
  change streams are unsupported (watch returns CommandNotSupported(115)). Do NOT
  enable these features after cutover until `add-ferretdb-realtime-cdc-remediation`
  is applied."
- [ ] T07.4 Add a rollback section at the end: revert `MONGO_URI` to the original
  MongoDB endpoint, perform pod restart / Helm upgrade, and reference
  `add-ferretdb-rollback-plan` for the full rollback procedure.
- [ ] T07.5 Document the `MONGO_URI` re-point step with the exact environment
  variable change, the engine-first startup-order requirement (postgres-documentdb
  must be Ready before ferretdb starts), and the Helm upgrade / pod restart
  commands required to apply it.

## T08: Non-prod dry-run and results artifact

- [ ] T08.1 Execute the full cutover runbook against a non-production FerretDB
  environment (tests/env with mongo:7 source and FerretDB 2.7.0 target via
  Docker Compose, or local kind cluster).
- [ ] T08.2 Collect preflight output, pre-copy snapshot, delta export log, upsert
  log, post-delta snapshot, snapshot-diff output, index recreation log, and
  per-step outcomes.
- [ ] T08.3 Commit the collected output as
  `tools/migration/ferretdb/runbook-results/<env>-<timestamp>.md` containing:
  environment identifier, execution timestamp, pre/post snapshot sha256 digests,
  index recreation pass/fail per collection, and outcome of each runbook step.

## T09: Validation

- [ ] T09.1 Run `compare-snapshots.sh` on the non-prod pre/post snapshots and
  confirm exit zero (counts and checksums match); record in results artifact.
- [ ] T09.2 Verify `upsert.sh` is idempotent: run it twice in delta mode and
  confirm no duplicate documents are inserted and document counts are unchanged.
- [ ] T09.3 Confirm index presence on FerretDB via `export-indexes.sh` matches the
  source MongoDB index definitions, including text and 2dsphere indexes.
- [ ] T09.4 Confirm the runbook contains no reference to `--oplogReplay`,
  `commitTransaction`, or a zero-downtime/dual-write alternative section.
- [ ] T09.5 Confirm the realtime/CDC out-of-scope notice is present and references
  `add-ferretdb-realtime-cdc-remediation`.
