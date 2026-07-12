# SeaweedFS → MinIO Rollback Runbook

> Change: `add-seaweedfs-rollback-plan` (#438). Companion to the cutover runbook
> `tools/migration/RUNBOOK.md` (`add-seaweedfs-data-migration-runbook`). This is an
> operational runbook: the **plan** is authored here at change time; the dated
> execution records (sections 4 and 5) are filled in by the operator at the real
> cutover / decommission window.

This runbook makes the MinIO → SeaweedFS cutover production-safe by providing a
tested, **time-bounded** path back to MinIO. It is activated **after** cutover and
stays in force for the rollback retention window.

---

## 0. Dependencies & prerequisites (verify before cutover)

| # | Prerequisite | State (verified for this change) |
|---|--------------|----------------------------------|
| 1.1 | Side-by-side chart toggle | `seaweedfs.enabled` in `../falcone-charts/charts/in-falcone/values.yaml:2157` (default `false`). The toggle comment states *"rollback = set it back to false, MinIO is untouched"*. MinIO `storage` component (`../falcone-charts/charts/in-falcone/values.yaml:2043`) is independent and stays `enabled: true`. **Available** (`add-seaweedfs-deployment`, archived). |
| 1.2 | Cutover runbook | `tools/migration/RUNBOOK.md` + `migrate.sh` / `snapshot.sh` / `compare-snapshots.sh` (`add-seaweedfs-data-migration-runbook`, branch `feat/seaweedfs-data-migration-runbook`; merges before this change per epic #430 resolution order). |
| 1.3 | Per-tenant smoke / parity gate | `tests/env/validation/run-validation.sh` → `parity-check.mjs` + `smoke-storage.mjs` (`add-seaweedfs-migration-validation`). Black-box: `tests/blackbox/seaweedfs-migration-validation.test.mjs`. The entrypoint honours `S3_ENDPOINT` and is explicitly built to *"gate … the rollback-plan go/no-go"*. **Present & runnable.** |
| 1.4 | Rollback window length **N** | **Default N = 7 days.** Counts from cutover completion (section 1 of the cutover runbook) to the decommission gate (section 5 here). **Confirm with the ops team before cutover and record the agreed value below.** |

**Agreed rollback window: N = `7` days** _(default; replace if ops confirms a different value — recorded by: ________, date: ________)_.

---

## 1. Read-only retention (state during the window)

After cutover the following invariants hold for the whole window:

- The MinIO `storage` StatefulSet **stays running** (`storage.enabled: true`). It is
  NOT torn down at cutover.
- The MinIO PVC **stays Bound**. The chart uses `storage.persistence.existingClaim: ""`
  with no delete-on-upgrade / delete-on-uninstall annotation, so `helm upgrade` and
  `helm uninstall` do **not** reclaim it (StatefulSet `volumeClaimTemplate` retention).
- The app is re-pointed to SeaweedFS at cutover
  (`STORAGE_S3_ENDPOINT → http://<release>-seaweedfs-s3:8333`), so **no new writes**
  reach MinIO. MinIO is effectively **READ-ONLY** — it exists only as the rollback
  target.

These invariants are annotated at the source in `../falcone-charts/charts/in-falcone/values.yaml`
above the `storage:` block.

---

## 2. Rollback trigger conditions

Initiate rollback (section 3) if, **within the window**, any of the following holds:

- **Write error rate** on SeaweedFS S3 (`8333`) exceeds the agreed SLO (5xx /
  signature / quota failures on PUT/multipart) sustained beyond the alert window.
- **Latency** (p99 PUT/GET against SeaweedFS) regresses beyond the agreed threshold
  vs. the MinIO baseline captured pre-cutover.
- **Data-integrity / parity** failure: `run-validation.sh` against SeaweedFS reports
  missing keys or ETag mismatches that are not reviewed exceptions.
- **Tenant-isolation** regression: the cross-tenant negative probe in
  `smoke-storage.mjs` fails (Tenant A reaches Tenant B's bucket).
- **Operator decision**: any SeaweedFS-specific incident the on-call judges unsafe to
  ride out within the window.

> If a monitoring alert fires when the MinIO StatefulSet becomes unhealthy *while
> read-only* during the window, wire it here too (design Open Question OQ-2).

---

## 3. Rollback procedure (ordered checklist)

Execute **in order**. Do not skip the smoke gate.

1. **Freeze writes.** Pause tenant write traffic to the storage API (gateway
   maintenance route / scale the data-plane writers to 0, per the cutover runbook's
   freeze step). Confirm no in-flight multipart uploads.
2. **Re-point Falcone config to MinIO.** Flip the backend back to the retained MinIO
   endpoint:
   - `STORAGE_S3_ENDPOINT → http://<release>-storage:9000` (path-style); for kind/dev
     `http://falcone-storage:9000`.
   - Credentials from secret `in-falcone-storage` (`MINIO_ROOT_USER` /
     `MINIO_ROOT_PASSWORD`; legacy `MINIO_*` fallbacks already wired in
     `../falcone-charts/deploy/kind/values-kind.yaml`).
   - Set `seaweedfs.enabled: false` (or leave SeaweedFS running but stop routing to
     it — re-pointing `STORAGE_S3_ENDPOINT` is the authoritative switch; the toggle
     governs whether SeaweedFS pods stay up).
   - Roll the app deployments so the new endpoint env is picked up.
3. **Run the per-tenant storage smoke test** against MinIO:
   ```bash
   S3_ENDPOINT=http://localhost:59000 \
   S3_ACCESS_KEY=<minio-root-user> S3_SECRET_KEY=<minio-root-password> \
     bash tests/env/validation/run-validation.sh
   ```
   (In-cluster: point `S3_ENDPOINT` at the MinIO Service `:9000`.) The script runs the
   object-parity check **and** the per-tenant smoke + cross-tenant negative probe, and
   exits non-zero naming the failing check.
4. **Confirm green.** Proceed only when `run-validation.sh` exits `0` for every tenant
   and the cross-tenant probe denies A→B.
5. **Resume traffic.** Lift the write freeze. Monitor error rate / latency against the
   MinIO baseline.

### 3a. Delta-back sync note (writes made on SeaweedFS during the window)

The window is treated as **read-only on the old store**: objects written to SeaweedFS
between cutover and rollback are **NOT** automatically synced back to MinIO. The window
is bounded (default 7 days) to keep this delta small.

If those objects must be preserved, run a manual delta-back sync **before** step 5
(resume): snapshot SeaweedFS, diff against the pre-cutover MinIO snapshot, and copy the
delta keys back with `tools/migration/migrate.sh` run in the reverse direction
(source = SeaweedFS S3 gateway, destination = MinIO). Re-run `run-validation.sh` after
the sync to confirm parity before resuming traffic.

### 3b. ⚠ Point-of-no-return

> **Deleting the MinIO PVC makes rollback impossible without a backup restore. Do not
> proceed unless the non-prod gate (section 4) is green.**

Before cutover, rollback is free (MinIO still authoritative). After cutover and within
the window, rollback costs only the section-3a delta. **Once the MinIO PVC is reclaimed
(section 5), the only recovery path is restore-from-backup** — follow the backup/restore
capability, not this runbook.

---

## 4. Non-prod rollback validation gate (REQUIRED before decommission)

Before any decommission step in section 5, the rollback procedure MUST be executed and
proven green on a non-prod copy (staging or kind). This guards against the rollback
procedure itself being broken at the moment it is needed.

Procedure:

- **4.1** On non-prod (staging or kind), execute section 3 steps 1–2: re-point the
  storage backend to the MinIO endpoint via the chart toggle / `STORAGE_S3_ENDPOINT`.
- **4.2** Run the per-tenant smoke against the non-prod MinIO endpoint:
  ```bash
  S3_ENDPOINT=<non-prod-minio-endpoint> \
  S3_ACCESS_KEY=<...> S3_SECRET_KEY=<...> \
    bash tests/env/validation/run-validation.sh
  ```
- **4.3** Confirm the run exits `0` (parity + per-tenant smoke + cross-tenant probe all
  pass) and **record the result** in the table below.
- **4.4** **Decommission gate:** section 5 is BLOCKED until a green row exists in 4.3.

### Gate result record (fill at execution)

| Environment | Date (UTC) | Executor | `run-validation.sh` exit | Per-tenant smoke | Cross-tenant probe | Result |
|-------------|-----------|----------|--------------------------|------------------|--------------------|--------|
| kind `test-cluster-b` / ns `falcone` | 2026-06-14 12:56 | Andrea Mucci | `0` | PASS (ten-a + ten-b, all 5 routes 2xx) | skipped (MinIO single-cred target) | ✅ green |

> Companion machine-readable result:
> `tools/migration/runbook-results/kind-rollback-gate-20260614T125657Z.md`.

---

## 5. Decommission (after window elapsed AND gate green)

Only proceed when **both**: (a) the rollback window N has elapsed with no trigger, and
(b) section 4.3 has a **green** record.

- **5.1** Delete the MinIO `storage` StatefulSet from the cluster.
- **5.2** Delete the MinIO PVC. **⚠ POINT-OF-NO-RETURN** — re-read section 3b and
  confirm the section-4.3 gate result is green before executing. After this, rollback
  is only possible via backup restore.
- **5.3** Disable the side-by-side chart toggle: in `../falcone-charts/charts/in-falcone/values.yaml` set
  the end state (SeaweedFS sole backend) — `seaweedfs.enabled: true`, MinIO `storage`
  component removed/`enabled: false`. Commit the chart change.
- **5.4** Record the decommission outcome below.

### Decommission record (fill at execution)

| Field | Value |
|-------|-------|
| Decommission date (UTC) | 2026-06-14 13:33 |
| Executor | Andrea Mucci |
| Gate record referenced (from 4.3) | `kind-rollback-gate-20260614T125657Z.md` + SeaweedFS cutover gate (PASS) |
| Final smoke result | ✅ green (live app PUT+HEAD on SeaweedFS, MinIO gone) |
| StatefulSet deleted | ✅ `falcone-storage` NotFound |
| PVC deleted (point-of-no-return) | ✅ `falcone-storage-data` (100Gi) reclaimed |
| Chart toggle finalized | ✅ release rev 47: `seaweedfs.enabled=true`, `storage.enabled=false` |

> Full execution record: `tools/migration/runbook-results/kind-decommission-20260614T133327Z.md`.
> Three chart defects were fixed to make SeaweedFS deployable (filer init image, dev
> replication `001`→`000`, NetworkPolicy label case) — see that record.

---

## Appendix — quick reference

| Action | Setting |
|--------|---------|
| Cutover (→ SeaweedFS) | `STORAGE_S3_ENDPOINT=http://<release>-seaweedfs-s3:8333`, `seaweedfs.enabled: true` |
| Rollback (→ MinIO) | `STORAGE_S3_ENDPOINT=http://<release>-storage:9000`, creds secret `in-falcone-storage`, `seaweedfs.enabled: false` |
| Validation gate | `bash tests/env/validation/run-validation.sh` (set `S3_ENDPOINT` to the target backend) |
| Point-of-no-return | MinIO PVC deletion (section 5.2) |
| Window | N = 7 days (default; confirm per env in section 0) |
