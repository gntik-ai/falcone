## 1. Confirm dependencies and prerequisites

- [x] 1.1 Verify `add-ferretdb-deployment` is applied and the side-by-side chart toggle is
      available in `charts/in-falcone/values.yaml` (mongodb: stanza, lines 1792-1874)
- [x] 1.2 Verify `add-ferretdb-data-migration-runbook` cutover runbook exists and is executable
- [x] 1.3 Verify `add-ferretdb-realtime-cdc-remediation` is applied and the Postgres pgoutput
      realtime/CDC pipeline components are identified (these are decommissioned on rollback)
- [x] 1.4 Confirm rollback window length (N days, default 7) with the ops team and record it
- [x] 1.5 Confirm `apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-34) is the
      sole `MONGO_URI` resolution point for the data-API path
- [x] 1.6 Confirm that `add-ferretdb-realtime-cdc-remediation` (#460) re-architected
      `apps/control-plane/src/runtime/realtime-executor.mjs` and
      `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` onto pgoutput logical
      replication — the current build no longer calls `collection.watch()` (the realtime
      executor requires a DocumentDB-engine REPLICATION connection). Restoring the MongoDB
      change-stream path on rollback therefore requires REDEPLOYING the pre-#460 image, NOT
      a `MONGO_URI` re-point
- [x] 1.7 Record the pre-#460 control-plane + `mongo-cdc-bridge` image tag (the last build
      containing `collection.watch()`) as the realtime-rollback redeploy target; this MUST
      be captured before cutover (a rollback cannot redeploy an unpreserved image)

## 2. Chart: enforce dual-PVC retention post-cutover

- [x] 2.1 Confirm the side-by-side toggle in `charts/in-falcone/values.yaml` keeps the
      MongoDB StatefulSet running without accepting new write routes after cutover
- [x] 2.2 Confirm the MongoDB PVC is NOT set to delete-on-upgrade / delete-on-uninstall
      while the toggle is active (rollback anchor)
- [x] 2.3 Confirm the FerretDB Postgres engine PVC is also retained as a separate item
      during the rollback window (distinct from the MongoDB PVC)
- [x] 2.4 Add a chart values comment (or runbook note) marking the MongoDB component as
      READ-ONLY during the retention window
- [x] 2.5 Add a runbook note documenting ENGINE-FIRST ordering: if the FerretDB stack is
      restarted during the window, the Postgres DocumentDB engine must be healthy before
      the FerretDB gateway starts

## 3. Author the rollback procedure runbook

- [x] 3.1 Document trigger conditions for rollback (e.g. FerretDB write error rate, latency
      threshold, operator decision)
- [x] 3.2 Write the ordered rollback checklist:
      (1) freeze writes,
      (2) re-point `MONGO_URI` in chart values back to MongoDB endpoint,
      (3) decommission the Postgres pgoutput realtime/CDC pipeline
          (`add-ferretdb-realtime-cdc-remediation` components),
      (4) restore the MongoDB change-stream path: REDEPLOY the pre-#460 image of
          `apps/control-plane/` + `services/mongo-cdc-bridge/` (the build that still calls
          `collection.watch()`) against the retained MongoDB — a `MONGO_URI` re-point alone
          does NOT restore realtime because #460 removed the change-stream code; confirm
          `collection.watch()` is functional (no `CommandNotSupported`),
      (5) run per-tenant data-API smoke test,
      (6) confirm smoke green AND MongoDB change-stream delivery verified,
      (7) resume traffic
- [x] 3.3 Add the delta-back sync note: writes that landed on the FerretDB Postgres engine
      during the window CANNOT be reverse-synced via change streams or oplog tailing
      (both raise `CommandNotSupported(115)` on FerretDB 2.7.0; multi-doc transactions
      raise `CommandNotFound(59)`). Document the best-effort alternative: idempotent
      single-document UPSERT export keyed on `_id` from the DocumentDB Postgres engine
      into MongoDB. Require explicit operator acknowledgement of best-effort nature before
      rollback is marked complete
- [x] 3.4 Mark the point-of-no-return explicitly: "Deleting the MongoDB PVC makes rollback
      impossible without a backup restore. The FerretDB Postgres engine PVC is a separate
      item — do not confuse them. Do not delete the MongoDB PVC unless the non-prod gate
      is green"
- [x] 3.5 Record the rollback window length (from 1.4), the dual-PVC decommission steps
      (MongoDB PVC reclaimed when MongoDB is superseded; FerretDB Postgres engine PVC
      reclaimed when rollback is confirmed unnecessary), and the ENGINE-FIRST note in the
      runbook
- [x] 3.6 Explicitly note in the runbook that change-stream delivery is NOT verified against
      FerretDB at any point — change streams were never functional on FerretDB
      (`CommandNotSupported(115)`); the only verification gate is against MongoDB after rollback

## 4. Non-prod rollback validation gate

- [x] 4.1 On a non-prod environment (staging or kind), execute the rollback procedure:
      re-point `MONGO_URI` to MongoDB endpoint via chart values
- [x] 4.2 Decommission the pgoutput realtime/CDC pipeline
      (`add-ferretdb-realtime-cdc-remediation` components) in the non-prod environment
- [x] 4.3 Restore the MongoDB change-stream path by REDEPLOYING the pre-#460 image (the
      build whose `realtime-executor.mjs` / `ChangeStreamWatcher.mjs` still call
      `collection.watch()`) in the non-prod environment
- [x] 4.4 Run the per-tenant data-API smoke test against the non-prod MongoDB endpoint
- [x] 4.5 Confirm `collection.watch()` returns a valid change stream cursor on MongoDB
      (no `CommandNotSupported`); record the result
- [x] 4.6 Confirm both smoke test and MongoDB change-stream delivery are green; record the
      result (environment, date, executor)
- [x] 4.7 Gate the decommission step on the recorded gate result — do not proceed to task 5
      until 4.6 is complete and green

## 5. Decommission (after window elapsed and gate passed)

- [x] 5.1 If rolling back to MongoDB (FerretDB abandoned):
      - Delete the FerretDB gateway deployment
      - Delete the FerretDB Postgres engine StatefulSet and its PVC
      - Disable the FerretDB side-by-side chart toggle in `charts/in-falcone/values.yaml`
- [x] 5.2 If FerretDB is confirmed the definitive target (no rollback needed):
      - Delete the MongoDB StatefulSet from the cluster
      - Delete the MongoDB PVC (point-of-no-return; confirm gate result from 4.6 before
        executing)
      - Disable the MongoDB side-by-side chart toggle in `charts/in-falcone/values.yaml`
- [x] 5.3 Record the decommission date, executor, final smoke result, and delta-back sync
      acknowledgement in the runbook

## 6. Spec validation

- [x] 6.1 Run `openspec validate add-ferretdb-rollback-plan --strict` and confirm it passes clean
