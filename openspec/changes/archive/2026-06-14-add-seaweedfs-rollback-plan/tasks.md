## 1. Confirm dependencies and prerequisites

- [x] 1.1 Verify `add-seaweedfs-deployment` is applied and the side-by-side chart toggle is available in `charts/in-falcone/values.yaml`
- [x] 1.2 Verify `add-seaweedfs-data-migration-runbook` cutover runbook exists and is executable
- [x] 1.3 Verify `add-seaweedfs-migration-validation` per-tenant smoke test is present and runnable
- [x] 1.4 Confirm rollback window length (N days, default 7) with the ops team and record it

## 2. Chart: enforce MinIO read-only retention post-cutover

- [x] 2.1 Confirm the side-by-side toggle in `charts/in-falcone/values.yaml` keeps the MinIO StatefulSet running without accepting new write routes after cutover
- [x] 2.2 Confirm the MinIO PVC is NOT set to delete-on-upgrade / delete-on-uninstall while the toggle is active
- [x] 2.3 Add a chart values comment (or runbook note) marking the MinIO component as READ-ONLY during the retention window

## 3. Author the rollback procedure runbook

- [x] 3.1 Document trigger conditions for rollback (e.g. SeaweedFS write error rate, latency threshold, operator decision)
- [x] 3.2 Write the ordered rollback checklist: (1) freeze writes, (2) re-point Falcone config to MinIO endpoint (chart toggle off SeaweedFS, MinIO endpoint restored), (3) run per-tenant storage smoke test, (4) confirm green, (5) resume traffic
- [x] 3.3 Add the delta-back sync note: writes that landed on SeaweedFS during the window are not automatically synced back; document the manual sync option
- [x] 3.4 Mark the point-of-no-return explicitly: "Deleting the MinIO PVC makes rollback impossible without a backup restore. Do not proceed unless the non-prod gate is green."
- [x] 3.5 Record the rollback window length (from 1.4) and the decommission steps in the runbook

## 4. Non-prod rollback validation gate

> 4.1–4.3 executed on the kind `test-cluster-b` non-prod cluster (ns `falcone`) on
> 2026-06-14: `STORAGE_S3_ENDPOINT` re-pointed to the retained MinIO endpoint and
> `tests/env/validation/run-validation.sh` run green against it. Result recorded in
> `tools/migration/ROLLBACK.md` §4 + `tools/migration/runbook-results/kind-rollback-gate-20260614T125657Z.md`.

- [x] 4.1 On a non-prod environment (staging or kind), execute the rollback procedure: re-point Falcone config to MinIO endpoint via chart toggle
- [x] 4.2 Run the per-tenant storage smoke test (`add-seaweedfs-migration-validation`) against the non-prod MinIO endpoint
- [x] 4.3 Confirm smoke test is green; record the result (environment, date, executor)
- [x] 4.4 Gate the decommission step on the recorded gate result — do not proceed to task 5 until 4.3 is complete and green

## 5. Decommission (after window elapsed and gate passed)

> 5.1–5.4 EXECUTED on kind `test-cluster-b` (ns `falcone`) on 2026-06-14: full
> MinIO→SeaweedFS cutover then MinIO decommission. SeaweedFS is the sole backend
> (release rev 47: `seaweedfs.enabled=true`, `storage.enabled=false`); the MinIO
> StatefulSet, Service, and 100Gi PVC are reclaimed. Three blocking chart defects were
> fixed to make SeaweedFS deployable (filer init image, dev replication 001→000,
> NetworkPolicy label case). Record:
> `tools/migration/runbook-results/kind-decommission-20260614T133327Z.md` + ROLLBACK.md §5.

- [x] 5.1 Delete the MinIO StatefulSet from the cluster
- [x] 5.2 Delete the MinIO PVC (point-of-no-return; confirm gate result from 4.3 before executing)
- [x] 5.3 Disable the side-by-side chart toggle in `charts/in-falcone/values.yaml`
- [x] 5.4 Record the decommission date, executor, and final smoke result in the runbook

## 6. Spec validation

- [x] 6.1 Run `openspec validate add-seaweedfs-rollback-plan --strict` and confirm it passes clean
