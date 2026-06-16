## Why

Cutting over from MongoDB to FerretDB+DocumentDB carries operational risk. If the new
engine exhibits problems after cutover there is currently no tested procedure to re-point
Falcone back to MongoDB. A time-bounded, tested rollback capability is required before
the cutover can be treated as production-safe.

The connection entry point is `apps/control-plane/src/runtime/main.mjs::mongoUri`
(lines 33-34), which reads `MONGO_URI` from the environment. MongoDB is deployed via the
`mongodb:` stanza in `charts/in-falcone/values.yaml` (line 1792, `enabled: true`).
Realtime and CDC are served by the Postgres pgoutput logical-replication pipeline
introduced by `add-ferretdb-realtime-cdc-remediation` (#460). **That change REPLACED the
MongoDB change-stream code**: `apps/control-plane/src/runtime/realtime-executor.mjs` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` were re-architected onto pgoutput
and no longer call `collection.watch()` at all — the realtime executor now requires a
DocumentDB-engine REPLICATION connection (`engineConnectionConfig`) and consumes a
`WalReplicationClient` slot, throwing at construction without one. MongoDB change streams
are unsupported on FerretDB (`collection.watch()` raises `CommandNotSupported(115)` on
FerretDB 2.7.0), which is WHY #460 removed that path. Consequently, rolling realtime/CDC
back to MongoDB is NOT a `MONGO_URI` re-point: it requires REDEPLOYING the pre-#460
release image (the last build that still contains the `collection.watch()` path) against
the retained MongoDB. The FerretDB engine is a dedicated Postgres StatefulSet whose PVC
is a separate retention concern from the MongoDB PVC.

## What Changes

- After cutover, the MongoDB StatefulSet is retained in a read-only state (no new writes
  accepted) for a defined window (N days, default 7) by keeping the side-by-side chart
  toggle active and not reclaiming its PVC.
- A rollback procedure is documented as an ordered checklist: freeze writes, re-point
  `MONGO_URI` in the chart back to MongoDB (restores the DATA-API path — config-only),
  decommission the pgoutput realtime/CDC pipeline (`add-ferretdb-realtime-cdc-remediation`
  components), restore the MongoDB change-stream path by REDEPLOYING the pre-#460 release
  image of the control-plane + `mongo-cdc-bridge` (the build that still calls
  `collection.watch()`) against the retained MongoDB, validate with the per-tenant
  data-API smoke test and MongoDB change-stream delivery, then resume traffic.
- The realtime/CDC rollback path is explicitly covered: rolling back to MongoDB means
  decommissioning the Postgres pgoutput pipeline AND redeploying the pre-#460 image — the
  build whose `realtime-executor.mjs` / `ChangeStreamWatcher.mjs` still call
  `collection.watch()`. #460 removed the change-stream code from the current build, so a
  `MONGO_URI` re-point alone does NOT restore realtime (the current realtime executor
  requires a DocumentDB-engine REPLICATION connection and cannot watch a MongoDB).
  `collection.watch()` DOES work against MongoDB — it was only unsupported on FerretDB — so
  once the pre-#460 image runs against MongoDB, realtime is functional again; there is
  nothing to verify or revert on the FerretDB side.
- A new prerequisite: the pre-#460 control-plane + `mongo-cdc-bridge` image tag (the last
  build with the MongoDB `collection.watch()` path) MUST be recorded before cutover — a
  realtime rollback cannot redeploy an image that was never preserved.
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
- `apps/control-plane/src/runtime/realtime-executor.mjs`: post-#460 this module is
  pgoutput-only (consumes a `WalReplicationClient` against the DocumentDB engine; no
  `collection.watch()`). Restoring the MongoDB change-stream path on rollback requires
  REDEPLOYING the pre-#460 image, not a `MONGO_URI` re-point. `collection.watch()` works
  against MongoDB once that image is running.
- `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs`: post-#460 this watcher consumes
  a `WalReplicationClient` (pgoutput) instead of `collection.watch()`. Same pre-#460-image
  redeploy is required to restore the MongoDB change-stream CDC path on rollback.
- `add-ferretdb-realtime-cdc-remediation`: the pgoutput realtime/CDC pipeline introduced
  by that change is the realtime source during the FerretDB window and is decommissioned
  as part of rollback.
- Data migration runbook (`add-ferretdb-data-migration-runbook`): cutover runbook that
  precedes this rollback window.
- No application source code changes; this is infrastructure/ops-only (P2).
