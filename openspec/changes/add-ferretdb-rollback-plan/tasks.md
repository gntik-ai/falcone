## 1. Confirm dependencies and prerequisites

- [ ] 1.1 Verify `add-ferretdb-deployment` is applied and the side-by-side chart toggle is
      available in `charts/in-falcone/values.yaml` (mongodb: stanza, lines 1792-1874)
- [ ] 1.2 Verify `add-ferretdb-data-migration-runbook` cutover runbook exists and is executable
- [ ] 1.3 Verify `add-ferretdb-realtime-cdc-remediation` is applied and the Postgres pgoutput
      realtime/CDC pipeline components are identified (these are decommissioned on rollback)
- [ ] 1.4 Confirm rollback window length (N days, default 7) with the ops team and record it
- [ ] 1.5 Confirm `apps/control-plane/src/runtime/main.mjs::mongoUri` (lines 33-34) is the
      sole `MONGO_URI` resolution point for the data-API path
- [ ] 1.6 Confirm that `realtime-executor.mjs:66` and
      `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs:42` are the change-stream
      entry points to be restored on rollback (both raise `CommandNotSupported(115)` on
      FerretDB; they will be functional again once `MONGO_URI` points to MongoDB)

## 2. Chart: enforce dual-PVC retention post-cutover

- [ ] 2.1 Confirm the side-by-side toggle in `charts/in-falcone/values.yaml` keeps the
      MongoDB StatefulSet running without accepting new write routes after cutover
- [ ] 2.2 Confirm the MongoDB PVC is NOT set to delete-on-upgrade / delete-on-uninstall
      while the toggle is active (rollback anchor)
- [ ] 2.3 Confirm the FerretDB Postgres engine PVC is also retained as a separate item
      during the rollback window (distinct from the MongoDB PVC)
- [ ] 2.4 Add a chart values comment (or runbook note) marking the MongoDB component as
      READ-ONLY during the retention window
- [ ] 2.5 Add a runbook note documenting ENGINE-FIRST ordering: if the FerretDB stack is
      restarted during the window, the Postgres DocumentDB engine must be healthy before
      the FerretDB gateway starts

## 3. Author the rollback procedure runbook

- [ ] 3.1 Document trigger conditions for rollback (e.g. FerretDB write error rate, latency
      threshold, operator decision)
- [ ] 3.2 Write the ordered rollback checklist:
      (1) freeze writes,
      (2) re-point `MONGO_URI` in chart values back to MongoDB endpoint,
      (3) decommission the Postgres pgoutput realtime/CDC pipeline
          (`add-ferretdb-realtime-cdc-remediation` components),
      (4) restore the MongoDB change-stream path: restart `apps/control-plane/src/runtime/realtime-executor.mjs`
          and `services/mongo-cdc-bridge/` with `MONGO_URI` pointing to MongoDB;
          confirm `collection.watch()` is functional (no `CommandNotSupported`),
      (5) run per-tenant data-API smoke test,
      (6) confirm smoke green AND MongoDB change-stream delivery verified,
      (7) resume traffic
- [ ] 3.3 Add the delta-back sync note: writes that landed on the FerretDB Postgres engine
      during the window CANNOT be reverse-synced via change streams or oplog tailing
      (both raise `CommandNotSupported(115)` on FerretDB 2.7.0; multi-doc transactions
      raise `CommandNotFound(59)`). Document the best-effort alternative: idempotent
      single-document UPSERT export keyed on `_id` from the DocumentDB Postgres engine
      into MongoDB. Require explicit operator acknowledgement of best-effort nature before
      rollback is marked complete
- [ ] 3.4 Mark the point-of-no-return explicitly: "Deleting the MongoDB PVC makes rollback
      impossible without a backup restore. The FerretDB Postgres engine PVC is a separate
      item — do not confuse them. Do not delete the MongoDB PVC unless the non-prod gate
      is green"
- [ ] 3.5 Record the rollback window length (from 1.4), the dual-PVC decommission steps
      (MongoDB PVC reclaimed when MongoDB is superseded; FerretDB Postgres engine PVC
      reclaimed when rollback is confirmed unnecessary), and the ENGINE-FIRST note in the
      runbook
- [ ] 3.6 Explicitly note in the runbook that change-stream delivery is NOT verified against
      FerretDB at any point — change streams were never functional on FerretDB
      (`CommandNotSupported(115)`); the only verification gate is against MongoDB after rollback

## 4. Non-prod rollback validation gate

- [ ] 4.1 On a non-prod environment (staging or kind), execute the rollback procedure:
      re-point `MONGO_URI` to MongoDB endpoint via chart values
- [ ] 4.2 Decommission the pgoutput realtime/CDC pipeline
      (`add-ferretdb-realtime-cdc-remediation` components) in the non-prod environment
- [ ] 4.3 Restore the MongoDB change-stream path (`realtime-executor.mjs:66`,
      `ChangeStreamWatcher.mjs:42`) in the non-prod environment
- [ ] 4.4 Run the per-tenant data-API smoke test against the non-prod MongoDB endpoint
- [ ] 4.5 Confirm `collection.watch()` returns a valid change stream cursor on MongoDB
      (no `CommandNotSupported`); record the result
- [ ] 4.6 Confirm both smoke test and MongoDB change-stream delivery are green; record the
      result (environment, date, executor)
- [ ] 4.7 Gate the decommission step on the recorded gate result — do not proceed to task 5
      until 4.6 is complete and green

## 5. Decommission (after window elapsed and gate passed)

- [ ] 5.1 If rolling back to MongoDB (FerretDB abandoned):
      - Delete the FerretDB gateway deployment
      - Delete the FerretDB Postgres engine StatefulSet and its PVC
      - Disable the FerretDB side-by-side chart toggle in `charts/in-falcone/values.yaml`
- [ ] 5.2 If FerretDB is confirmed the definitive target (no rollback needed):
      - Delete the MongoDB StatefulSet from the cluster
      - Delete the MongoDB PVC (point-of-no-return; confirm gate result from 4.6 before
        executing)
      - Disable the MongoDB side-by-side chart toggle in `charts/in-falcone/values.yaml`
- [ ] 5.3 Record the decommission date, executor, final smoke result, and delta-back sync
      acknowledgement in the runbook

## 6. Spec validation

- [ ] 6.1 Run `openspec validate add-ferretdb-rollback-plan --strict` and confirm it passes clean
