## Why

Cutting over from MongoDB to FerretDB+DocumentDB carries operational risk. If the new
engine exhibits problems after cutover there is currently no tested procedure to re-point
Falcone back to MongoDB. A time-bounded, tested rollback capability is required before
the cutover can be treated as production-safe.

The connection entry point is `apps/control-plane/src/runtime/main.mjs::mongoUri`
(lines 33-34), which reads `MONGO_URI` from the environment. MongoDB is deployed via the
`mongodb:` stanza in `charts/in-falcone/values.yaml` (lines 1792-1874). Realtime and
CDC during the FerretDB window are served by the Postgres pgoutput logical-replication
pipeline introduced by `add-ferretdb-realtime-cdc-remediation` — NOT by MongoDB change
streams, which are unsupported on FerretDB (`collection.watch()` at
`apps/control-plane/src/runtime/realtime-executor.mjs:66` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42` both raise
`CommandNotSupported(115)` on FerretDB 2.7.0). The FerretDB engine is a dedicated
Postgres StatefulSet whose PVC is a separate retention concern from the MongoDB PVC.

## What Changes

- After cutover, the MongoDB StatefulSet is retained in a read-only state (no new writes
  accepted) for a defined window (N days, default 7) by keeping the side-by-side chart
  toggle active and not reclaiming its PVC.
- A rollback procedure is documented as an ordered checklist: freeze writes, re-point
  `MONGO_URI` in the chart back to MongoDB, decommission the pgoutput realtime/CDC
  pipeline (`add-ferretdb-realtime-cdc-remediation` components), restore the MongoDB
  change-stream path (`realtime-executor.mjs:66`, `ChangeStreamWatcher.mjs:42`), validate
  with the per-tenant data-API smoke test and MongoDB change-stream delivery, then resume
  traffic.
- The realtime/CDC rollback path is explicitly covered: rolling back to MongoDB means
  decommissioning the Postgres pgoutput pipeline and restoring the MongoDB change-stream
  path. MongoDB change streams (`collection.watch()`) DO work on MongoDB; there is
  nothing to verify or revert on the FerretDB side — change streams were never functional
  there.
- Writes that land on FerretDB+DocumentDB (Postgres engine) during the window are synced
  back via idempotent single-document UPSERT export keyed on `_id` from the DocumentDB
  engine — NOT via change-stream or oplog tailing (both unsupported on FerretDB). If full
  fidelity cannot be guaranteed the delta-back sync is treated as best-effort and requires
  explicit operator acknowledgement.
- Trigger conditions and the point-of-no-return are defined: the MongoDB PVC is the
  rollback anchor; the FerretDB Postgres engine PVC is a separate decommission item.
- A non-prod rollback test gate is required before the MongoDB decommission step: re-point
  to MongoDB, run per-tenant data-API smoke + confirm MongoDB change-stream delivery
  functional, confirm green before proceeding to PVC deletion.
- The decommission step covers both the MongoDB StatefulSet + PVC (when MongoDB is fully
  superseded) and the FerretDB Postgres engine + gateway (when rollback is confirmed
  unnecessary). ENGINE-FIRST ordering applies if the FerretDB stack needs to be restarted
  during the window.

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-api`: ADDED requirements for a tested, time-bounded rollback procedure from
  FerretDB+DocumentDB back to MongoDB, including dual-PVC retention strategy (MongoDB PVC
  is the rollback anchor; FerretDB Postgres engine PVC is separate), rollback trigger
  conditions, a defined point-of-no-return, a realtime/CDC fallback path that transitions
  from the pgoutput pipeline back to MongoDB change streams, a best-effort delta-back sync
  via single-document UPSERT (not change-stream/oplog), and a mandatory non-prod
  validation gate.

## Impact

- `apps/control-plane/src/runtime/main.mjs` (lines 33-34): `MONGO_URI` env var is the
  re-point target for both cutover and rollback.
- `charts/in-falcone/values.yaml` (lines 1792-1874): MongoDB StatefulSet + PVC must not
  be torn down at cutover; chart side-by-side toggle drives retention.
- `apps/control-plane/src/runtime/realtime-executor.mjs:66`: MongoDB change-stream path
  (`collection.watch()`) is restored on rollback. Was non-functional during the FerretDB
  window (CommandNotSupported); becomes functional again once `MONGO_URI` points to MongoDB.
- `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42`: CDC change-stream watcher
  is restored on rollback. Same unsupported/restored pattern.
- `add-ferretdb-realtime-cdc-remediation`: the pgoutput realtime/CDC pipeline introduced
  by that change is the realtime source during the FerretDB window and is decommissioned
  as part of rollback.
- Data migration runbook (`add-ferretdb-data-migration-runbook`): cutover runbook that
  precedes this rollback window.
- No application source code changes; this is infrastructure/ops-only (P2).
