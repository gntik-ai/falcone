## Context

Falcone's document-database connection is resolved in
`apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-34): the function returns
`process.env.MONGO_URI` when set, otherwise falls back to a constructed host string.
MongoDB is deployed as a Bitnami StatefulSet via the `mongodb:` chart stanza
(`charts/in-falcone/values.yaml:1792-1874`). The migration to FerretDB+DocumentDB
(engine `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`, gateway
`ghcr.io/ferretdb/ferretdb:2.7.0`) replaces this StatefulSet while keeping the same
`MONGO_URI` contract.

**Critical constraint: change streams are unsupported on FerretDB.** The pre-#460 builds of
`apps/control-plane/src/runtime/realtime-executor.mjs` and
`services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` used `collection.watch()`, which
raises `CommandNotSupported(115)` on FerretDB 2.7.0 (`changeStreamPreAndPostImages` raises
`UnknownBsonField(40415)`). `add-ferretdb-realtime-cdc-remediation` (#460) therefore
RE-ARCHITECTED both modules onto a Postgres pgoutput logical-replication pipeline: the
current builds no longer call `collection.watch()` (the realtime executor now requires a
DocumentDB-engine REPLICATION connection — `engineConnectionConfig` — and consumes a
`WalReplicationClient` slot, throwing at construction without one). Multi-document
transactions are also unsupported (commit raises `CommandNotFound(59)`; abort is a silent
no-op), ruling out transactional reverse sync. During the FerretDB window, realtime and
CDC are served exclusively by that pgoutput pipeline. Because the current build has no
MongoDB change-stream code, restoring realtime to MongoDB on rollback requires redeploying
the pre-#460 image — NOT a configuration change.

The FerretDB stack has two distinct PVCs: (1) the MongoDB PVC (the rollback anchor —
retained until the rollback window closes), and (2) the dedicated Postgres engine PVC
(a separate retention item — decommissioned when MongoDB is fully re-established and
the rollback window closes). ENGINE-FIRST startup ordering applies: the Postgres
DocumentDB engine must be healthy before the FerretDB gateway starts. If the FerretDB
stack is restarted during the window, this ordering must be preserved.

Without a tested, time-bounded rollback plan the cutover carries unacceptable risk:
operators have no safe path back if FerretDB+DocumentDB exhibits problems in the
post-cutover window.

This change is infrastructure/ops-only. No application source changes are required; the
storage backend is selected through the `MONGO_URI` environment variable and chart values,
and the realtime/CDC backend is selected through the pgoutput pipeline configuration.

## Goals / Non-Goals

**Goals:**

- Define the rollback window length (N days, default 7) and record it in the runbook.
- Specify that the MongoDB StatefulSet and PVC are NOT reclaimed until the window closes
  and a non-prod rollback test passes.
- Document an ordered rollback procedure: freeze writes, re-point `MONGO_URI`, decommission
  the pgoutput realtime/CDC pipeline, restore the MongoDB change-stream path
  (`realtime-executor.mjs:66`, `ChangeStreamWatcher.mjs:42`), validate (per-tenant
  data-API smoke + MongoDB change-stream delivery verified), resume.
- Define the point-of-no-return: once the MongoDB PVC is reclaimed, rollback is no
  longer possible without a restore from backup.
- Document the delta-back sync approach for writes that landed on the FerretDB Postgres
  engine during the window: idempotent single-document UPSERT keyed on `_id`, explicitly
  NOT oplog/change-stream tailing (unsupported). Mark as best-effort; require operator
  acknowledgement if full fidelity is not guaranteed.
- Gate the MongoDB decommission step on the non-prod rollback test being green.
- Enumerate the FerretDB Postgres engine PVC as a separate decommission item distinct
  from the MongoDB PVC.

**Non-Goals:**

- Permanent dual-run / multi-backend operation beyond the rollback window.
- Automated failover or health-based traffic switching between MongoDB and
  FerretDB+DocumentDB.
- Full transactional reverse sync (unsupported: FerretDB multi-doc transactions raise
  `CommandNotFound(59)` on commit).
- Oplog or change-stream tailing from FerretDB for the delta-back sync (unsupported:
  `CommandNotSupported(115)`).

## Decisions

### D1 — Re-point via MONGO_URI env var, not a separate Helm flag

`main.mjs::mongoUri` already reads `MONGO_URI` from the environment (line 34). Rolling
back is a single env-var change in the chart values (or a secret update), with no new
Helm flag or chart surface area required.

Alternative considered: add a `mongodb.rollbackEnabled` Helm flag. Rejected because it
duplicates existing env-var semantics and adds chart surface area with no operational
benefit during the rollback window.

### D2 — Delta-back sync via single-document UPSERT, not oplog/change-stream

Writes that land on FerretDB+DocumentDB (Postgres engine) during the window cannot be
reverse-synced via change streams or oplog tailing: `collection.watch()` raises
`CommandNotSupported(115)` on FerretDB, and multi-doc transactions raise
`CommandNotFound(59)`. The only viable path is an idempotent read-all-documents export
from the DocumentDB Postgres engine followed by per-document UPSERT (keyed on `_id`)
into MongoDB. This is best-effort: ordering and atomicity across documents are not
guaranteed. Operators must explicitly acknowledge this limitation before rollback
completes.

Alternative considered: bidirectional automated sync. Rejected because FerretDB's lack
of change-stream and transaction support makes it technically impossible.

### D3 — Realtime/CDC rollback decommissions pgoutput pipeline, redeploys the pre-#460 change-stream image

During the FerretDB window, realtime is served by the Postgres pgoutput logical-replication
pipeline (`add-ferretdb-realtime-cdc-remediation`, #460). Rolling back means:
1. Decommissioning the pgoutput pipeline.
2. Restoring the MongoDB change-stream path by REDEPLOYING the pre-#460 release image of the
   control-plane + `mongo-cdc-bridge` (the build whose `realtime-executor.mjs` /
   `ChangeStreamWatcher.mjs` still call `collection.watch()`) against the retained MongoDB,
   where `collection.watch()` works. A `MONGO_URI` re-point alone does NOT restore realtime:
   #460 deleted the change-stream code and the current realtime executor requires a
   DocumentDB-engine REPLICATION connection (it cannot watch a MongoDB). There is no
   "revert on the FerretDB side" — change streams were never functional there and never need
   to be verified against FerretDB.

This makes the pre-#460 image tag a cutover PREREQUISITE: it must be recorded before cutover
so it can be redeployed on rollback (a realtime rollback cannot use an image that was never
preserved). The data-API rollback (`MONGO_URI` re-point) remains config-only and is
independent of this image redeploy.

### D4 — Non-prod validation gate before decommission

A non-prod (staging) re-point test must be executed and must produce: (a) a green
per-tenant data-API smoke result, and (b) confirmed MongoDB change-stream delivery
functional (not FerretDB), before the decommission step is unblocked.

### D5 — Two-PVC topology: MongoDB PVC is rollback anchor; Postgres engine PVC is separate

The FerretDB Postgres engine PVC is distinct from the MongoDB PVC. The MongoDB PVC is the
rollback anchor and is retained for the full window. The Postgres engine PVC is
decommissioned together with the FerretDB gateway only after the rollback window closes
and the non-prod gate passes. ENGINE-FIRST ordering (Postgres engine up before gateway)
applies during any FerretDB stack restart within the window.

## Risks / Trade-offs

- [Rollback window writes may be lost or partially recovered] FerretDB+DocumentDB writes
  during the window are synced back via best-effort single-document UPSERT, not an atomic
  reverse migration. Operators must acknowledge this. Mitigation: window is bounded
  (default 7 days); explicit operator sign-off required.

- [PVC retention cost] Keeping both the MongoDB PVC and the Postgres engine PVC active
  for N days incurs storage cost. Mitigation: window is bounded; both PVCs are
  decommissioned at window close.

- [Non-prod gate may not match prod] The staging rollback test may not fully exercise
  prod data volumes. Mitigation: the gate tests the procedure (re-point + smoke green +
  MongoDB change-stream delivery verified), not data completeness.

- [Point-of-no-return is operator-controlled] Deletion of the MongoDB PVC is a manual
  step. Mitigation: the runbook makes the point-of-no-return explicit with a warning, and
  the decommission step is gated on the non-prod test.

- [Realtime gap during rollback transition] Between pgoutput pipeline decommission and
  MongoDB change-stream path restoration, realtime events may be lost. Mitigation: writes
  are frozen before decommissioning the pgoutput pipeline; the MongoDB change-stream path
  is restored and verified before writes resume.

## Migration Plan

1. `add-ferretdb-deployment` is applied first (FerretDB+DocumentDB deployed alongside
   MongoDB; `MONGO_URI` still points to MongoDB).
2. `add-ferretdb-realtime-cdc-remediation` is applied (Postgres pgoutput pipeline ready
   to replace MongoDB change streams).
3. `add-ferretdb-data-migration-runbook` cutover is executed (MongoDB frozen, `MONGO_URI`
   re-pointed to FerretDB gateway, pgoutput pipeline activated).
4. This rollback plan is activated: MongoDB StatefulSet kept running (read-only), MongoDB
   PVC retained, Postgres engine PVC retained separately, rollback window starts.
5. At window close: non-prod rollback test executed (re-point `MONGO_URI` to MongoDB,
   decommission pgoutput, restore MongoDB change-stream path, smoke + change-stream
   delivery green). If green, decommission step proceeds: delete MongoDB StatefulSet +
   PVC, then FerretDB Postgres engine + gateway + their PVC.

## Open Questions

- What is the exact value of N (rollback window length in days) for this deployment?
  Default proposed: 7 days. To be confirmed by the ops team before cutover.
- Is there a monitoring alert that fires if the MongoDB StatefulSet becomes unhealthy
  during the retention window? If so, wire it to the rollback trigger conditions.
- What is the acceptable data-loss threshold for the best-effort delta-back UPSERT sync?
  Operators must sign off before rollback completes.
