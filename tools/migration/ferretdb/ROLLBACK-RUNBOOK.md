# FerretDB → MongoDB Rollback Runbook (add-ferretdb-rollback-plan, #463)

Time-bounded, tested rollback from the FerretDB v2 + DocumentDB backend back to MongoDB. This
is the full procedure referenced by the cutover runbook (`RUNBOOK.md` → *Rollback*). It is
**infrastructure/ops-only** — no application source changes: the data backend is selected by
the `MONGO_URI` environment variable (`apps/control-plane-executor/src/runtime/main.mjs::mongoUri`,
lines 33-34) and chart values; realtime/CDC is selected by which control-plane build is
deployed.

> **Two planes roll back differently — this is the crux of this runbook:**
>
> - **Data-API plane** → roll back by re-pointing `MONGO_URI` to MongoDB. **Config-only.**
> - **Realtime/CDC plane** → roll back by **REDEPLOYING the pre-#460 image** (the build whose
>   `realtime-executor.mjs` / `ChangeStreamWatcher.mjs` still call `collection.watch()`).
>   **A `MONGO_URI` re-point alone does NOT restore realtime.** `add-ferretdb-realtime-cdc-remediation`
>   (#460) re-architected both modules onto a Postgres **pgoutput** logical-replication pipeline
>   and deleted the change-stream code; the current realtime executor requires a DocumentDB-engine
>   REPLICATION connection and cannot watch a MongoDB.

## Prerequisites — recorded BEFORE cutover

| Item | Value | Why |
|------|-------|-----|
| Rollback window length **N** | **default 7 days** | How long MongoDB is retained read-only as the rollback anchor. Confirm with ops before cutover. |
| Pre-#460 image tag | `<record at cutover>` | The last control-plane + `mongo-cdc-bridge` build containing the MongoDB `collection.watch()` path. **A realtime rollback cannot redeploy an image that was never preserved.** |
| MongoDB PVC | retained (rollback anchor) | Not reclaimed until the window closes AND the non-prod gate is green. |
| FerretDB Postgres engine PVC | retained separately | A distinct decommission item from the MongoDB PVC — do not confuse them. |

Verify before relying on this runbook:
- `apps/control-plane-executor/src/runtime/main.mjs::mongoUri` (lines 33-34) is the sole `MONGO_URI`
  resolution point for the data-API path.
- `apps/control-plane-executor/src/runtime/realtime-executor.mjs` and
  `packages/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` are **pgoutput-only** in the current
  build (no `collection.watch()`); restoring realtime requires the **pre-#460 image** redeploy.
- The chart `mongodb:` stanza (`../falcone-charts/charts/in-falcone/values.yaml`, line 1792, `enabled: true`)
  keeps MongoDB deployable and its PVC retained during the window.

## Trigger conditions

Initiate rollback within the window when any of these hold (operator decision, or alert-driven):
- FerretDB+DocumentDB write error rate exceeds the agreed threshold.
- Data-API latency regression beyond the agreed threshold.
- Data-integrity anomaly attributable to the FerretDB backend (e.g. the ADR-14 transaction
  abort silent-no-op surfacing as a partial write — see `add-ferretdb-migration-validation`, #462).
- Operator go/no-go decision after the cutover validation gate.

## Rollback checklist (ordered)

1. **Freeze writes.** Start a maintenance-window write-freeze so no new writes land on the
   FerretDB Postgres engine while rolling back.
2. **Re-point the data-API plane.** Re-point the control-plane back to the MongoDB endpoint and
   Helm-upgrade / restart the data-plane pods. This restores the data-API path
   (`main.mjs::mongoUri`) and is **config-only**.
   - The chart parameterizes the backend via `MONGO_HOST` + `MONGO_USER` + `MONGO_PASSWORD`, not
     a single `MONGO_URI` (verified on the kind test cluster: `MONGO_HOST=falcone-mongodb:27017`
     vs the FerretDB gateway service `falcone-ferretdb:27017`). Roll back by flipping `MONGO_HOST`
     to the `falcone-mongodb` service (and unset `MONGO_BACKEND`). Setting `MONGO_URI` also works
     and takes precedence — `main.mjs::mongoUri` returns `MONGO_URI` when set, otherwise builds the
     host string from `MONGO_HOST`.
3. **Decommission the pgoutput realtime/CDC pipeline.** Stop and remove the
   `add-ferretdb-realtime-cdc-remediation` (#460) components (the realtime SSE slot consumer and
   the `mongo-cdc-bridge` `WalReplicationClient` consumers); drop their logical-replication
   slots on the DocumentDB engine.
4. **Restore the realtime/CDC plane — REDEPLOY the pre-#460 image.** Deploy the recorded
   pre-#460 control-plane + `mongo-cdc-bridge` image (the build that still calls
   `collection.watch()`) against the retained MongoDB. **A `MONGO_URI` re-point alone does NOT
   restore realtime** — #460 removed the change-stream code, so the current (post-#460) build
   cannot watch a MongoDB. Confirm `collection.watch()` is functional on MongoDB (no
   `CommandNotSupported`).
5. **Validate.** Run the per-tenant data-API smoke against MongoDB (`rollback-validate.sh`,
   which reuses the `add-ferretdb-migration-validation` #462 smoke pointed at MongoDB).
6. **Confirm green.** The data-API smoke MUST pass AND MongoDB change-stream delivery MUST be
   verified functional (`collection.watch()` returns a valid cursor on MongoDB) before
   resuming traffic.
7. **Resume traffic.** Lift the write-freeze.

### Delta-back sync (writes that landed on FerretDB during the window)

Writes that landed on the FerretDB Postgres engine during the window **cannot** be reverse-synced
via change streams or oplog tailing — both are unsupported on FerretDB 2.7.0 (`collection.watch()`
raises `CommandNotSupported(115)`; multi-document transactions raise `CommandNotFound(59)` on
commit and abort is a silent no-op). The only viable path is a **best-effort idempotent
single-document UPSERT** export keyed on `_id` from the DocumentDB Postgres engine into MongoDB:

```bash
ROLLBACK_MONGO_URI=mongodb://<mongodb-endpoint>/ \
FERRETDB_URI=mongodb://falcone:falcone@<ferretdb-gateway>:27017/ \
  bash tools/migration/ferretdb/rollback-delta-back.sh --dbs all
```

This is **best-effort**: ordering and cross-document atomicity are NOT guaranteed. **The operator
MUST explicitly acknowledge the best-effort nature of the delta-back sync before the rollback is
marked complete.**

## Point-of-no-return

> ⚠ **Deleting the MongoDB PVC makes rollback impossible without a backup restore.** The FerretDB
> Postgres engine PVC is a **separate** item — do not confuse them. **Do not delete the MongoDB
> PVC unless the non-prod gate (below) is green.** After the MongoDB PVC is reclaimed, recovery is
> only possible via the backup-restore capability.

## Non-prod validation gate (REQUIRED before decommission)

Before deleting the MongoDB StatefulSet + PVC, execute the rollback procedure on a non-prod
(staging or kind) copy and confirm it is green:

```bash
ROLLBACK_MONGO_URI=mongodb://<nonprod-mongodb>/ \
  bash tools/migration/ferretdb/rollback-validate.sh
```

The gate passes only when **both** are true and recorded (environment, date, executor):
1. Per-tenant data-API smoke is green against the non-prod MongoDB endpoint.
2. MongoDB change-stream delivery is verified functional — `collection.watch()` returns a valid
   change-stream cursor on MongoDB without `CommandNotSupported`.

> Change-stream delivery is **NEVER verified against FerretDB** at any point — change streams were
> never functional on FerretDB (`CommandNotSupported(115)`), which is exactly why #460 replaced
> them with pgoutput. The verification gate applies **only to MongoDB** after rollback.

**Validated on the kind test cluster (2026-06-16):** the gate was run as an in-cluster Job against
the live `falcone-mongodb` replica set (`rs0`, credentials via the `in-falcone-mongodb` secret) and
returned `{"smokeOk":true,"crossTenantDenied":true,"changeDelivered":true,"ok":true}` — confirming
the data-API smoke, cross-tenant isolation, and MongoDB change-stream delivery all hold against the
rollback target. Note: the change-stream check MUST establish the `$changeStream` cursor before
inserting the probe document (a ~2s settle), otherwise the insert can precede the resume point and
the event is missed — `rollback-mongo-check.mjs` does this.

## Decommission (after the window elapses AND the gate is green)

**If rolling back to MongoDB (FerretDB abandoned):**
- Delete the FerretDB gateway deployment.
- Delete the FerretDB Postgres (DocumentDB) engine StatefulSet **and its PVC** (the separate
  retention item).
- Disable the FerretDB side-by-side toggle in `../falcone-charts/charts/in-falcone/values.yaml`.

**If FerretDB is confirmed the definitive target (no rollback needed):**
- Delete the MongoDB StatefulSet.
- Delete the MongoDB PVC — **point-of-no-return; confirm the gate result first.**
- Disable the MongoDB side-by-side toggle in `../falcone-charts/charts/in-falcone/values.yaml`.

**ENGINE-FIRST ordering:** if the FerretDB stack is restarted at any point during the window, the
Postgres DocumentDB engine MUST be healthy before the FerretDB gateway starts (the gateway depends
on the engine's `documentdb` extension being ready).

## Record at execution time

Record in this runbook (or a `runbook-results/` artifact, mirroring `RUNBOOK.md`): the chosen
rollback window length N, the decommission date and executor, the final smoke result, the MongoDB
change-stream verification result, and the operator acknowledgement of the best-effort delta-back
sync.
