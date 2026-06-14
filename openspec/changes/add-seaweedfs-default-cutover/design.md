## Context

After `add-seaweedfs-deployment` (archived), the umbrella chart carries a full SeaweedFS sub-chart (`charts/in-falcone/charts/seaweedfs`) plus wrapper templates (`seaweedfs-{s3-creds,db-init-configmap,networkpolicy,tls-bootstrap}.yaml`), gated behind `seaweedfs.enabled` which **defaults to `false`**; MinIO (`storage.enabled: true`) is still the default-active object store. The local test harness (`tests/env/`) runs a single `minio/minio:latest` container on host `:59000`/`:59001`, with `S3_*` env in `env.sh` pointing there and `up.sh` creating the `falcone-test` bucket via `mc`. Application code never names MinIO — `openapi-sdk-service` and `provisioning-orchestrator` resolve S3 through provider-agnostic `S3_ENDPOINT` / `S3_ACCESS_KEY(_ID)` / `S3_SECRET_KEY(_ACCESS_KEY)` / `S3_SDK_BUCKET`. `tests/env/validation/run-validation.sh` already supports `S3_ENDPOINT=http://localhost:58333` for SeaweedFS. This change flips the defaults so the documented and running states match.

## Goals / Non-Goals

**Goals:**

- Make SeaweedFS the default-active object store in the umbrella chart (`seaweedfs.enabled: true`, `storage.enabled: false`) for both the base and HA profiles, keeping MinIO re-enable-able for rollback.
- Migrate the `tests/env` Docker Compose stack from MinIO to SeaweedFS (master/volume/filer/s3, filer-on-Postgres) on host `:58333`, with the `falcone-test` bucket bootstrapped against the SeaweedFS gateway.
- Keep all real-stack suites green against SeaweedFS with **no application source changes** (only `S3_*` env + harness wiring move).

**Non-Goals:**

- The MinIO→SeaweedFS **data-copy** procedure (owned by `add-seaweedfs-data-migration-runbook`).
- The rollback/decommission runbook (owned by `add-seaweedfs-rollback-plan`); this change only ensures MinIO stays toggle-on-able.
- Per-tenant identity provisioning (owned by `add-seaweedfs-tenant-identities`); the harness uses a single dev S3 identity, as the MinIO harness did.
- `musematic-deploy` / external Hetzner S3 (out of scope; already disables bundled MinIO).
- Changing `S3_*` variable names or any adapter/provider code.

## Decisions

### D1 — Flip the chart default, keep MinIO as an explicit rollback toggle

Set `storage.enabled: false` and `seaweedfs.enabled: true` in `charts/in-falcone/values.yaml`. MinIO is not deleted from the chart — an operator sets `storage.enabled: true` to re-enable it during the retention window (`add-seaweedfs-rollback-plan`). Rationale: a single value flip per backend gives a clean, reversible cutover; PVC retain policy means no data is destroyed when MinIO is toggled off.

### D2 — HA profile mirrors the flip

`charts/in-falcone/values/profiles/ha.yaml` already overrides `seaweedfs` (3 master / 3 volume, replication `011`). Ensure the HA profile also disables MinIO so the HA object store is unambiguously SeaweedFS.

### D3 — `tests/env` SeaweedFS stack on `:58333`

Replace the `minio` Compose service with SeaweedFS components. The S3 gateway maps container `:8333` → host `:58333` (the port `validation/run-validation.sh` already documents), deliberately **not** reusing MinIO's `:59000` so a side-by-side bring-up during development never collides. Filer metadata uses the existing Compose Postgres (dedicated `seaweedfs_filer` database with the explicit `createTable` DDL proven necessary at 4.33).

### D4 — Provider-agnostic env is the seam

Consumers read `S3_ENDPOINT` / `S3_ACCESS_KEY(_ID)` / `S3_SECRET_KEY(_ACCESS_KEY)` / `S3_SDK_BUCKET`. Only `env.sh` changes (endpoint → `:58333`, keys → SeaweedFS dev identity). No service code changes. The `up.sh` bucket bootstrap moves off `mc` (MinIO-only) to a SeaweedFS-compatible path — `aws s3 mb --endpoint-url` (SigV4, already used elsewhere in the repo) or `weed shell`.

### D5 — Update all harness touchpoints in lockstep

`up.sh` health-gate + endpoint banner + the `minio-shared-1` seed provider row, `down.sh` service list, and `tests/env/README.md` are updated together so the harness is internally consistent and the docs match.

## Risks / Trade-offs

- **Multi-process Compose increases boot time / flakiness.** SeaweedFS is 4 processes vs MinIO's 1, with a filer→Postgres dependency. → Mitigation: explicit `depends_on` + healthchecks (filer readiness gates `up.sh`); reuse the deployment change's proven `createTable` DDL and PG-init idiom.
- **Suite regressions from envelope differences.** The hand-rolled regex XML parser and presigned paths were validated byte-compatible in the ADR-13 spike, but the harness exercises more callers. → Mitigation: run the full matrix (unit/contracts/integration/blackbox/validation) before merge; treat any red as a blocker.
- **Bucket-bootstrap tooling.** SeaweedFS images may not ship `mc`. → Mitigation: bootstrap via the S3 API (`aws s3 mb`) or `weed shell`, not `mc`.
- **Default flip is observable to existing installs.** Anyone relying on the default MinIO now gets SeaweedFS. → Mitigation: marked BREAKING; rollback is a one-line `storage.enabled: true` toggle; documented in the storage runbook's migration-status note.
