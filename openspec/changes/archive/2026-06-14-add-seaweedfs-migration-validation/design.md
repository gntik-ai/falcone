## Context

Falcone's object storage surface is live-wired through five routes (`deploy/kind/control-plane/routes.mjs:118-123`). The real-stack test harness (`tests/env/`) starts a MinIO container (host port 59000, creds `minioadmin`, bucket `falcone-test`) and exports `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` via `tests/env/env.sh`. After the SeaweedFS data migration, the same env vars are the only integration point; no code or chart changes are needed to swap the backend for validation purposes.

The SeaweedFS migration dependencies (`add-seaweedfs-storage-provider`, `add-seaweedfs-bucket-lifecycle-migration`, `add-seaweedfs-data-migration-runbook`) produce: a SeaweedFS container that is S3-compatible, per-tenant IAM identities, and a checksum manifest (object key + ETag pairs per bucket) captured at migration time.

## Goals / Non-Goals

**Goals:**

- Automated object-parity check: compare every migrated bucket's object count and ETag/checksum between MinIO (source) and SeaweedFS (destination) using the migration manifest.
- Per-tenant storage-API smoke for tenants A and B through Falcone's live API surface, confirming each tenant can list buckets, provision a bucket, list objects, fetch object metadata, and query workspace usage against SeaweedFS.
- Cross-tenant isolation NEGATIVE probe: Tenant A must be denied access to Tenant B's bucket and object prefix (HTTP 403 or 404).
- Single entrypoint runnable from `tests/env/`; passes or fails without manual interpretation.
- Result is green in `bash tests/blackbox/run.sh` and the CI `quality` job when the SeaweedFS-backed env is active.

**Non-Goals:**

- Full Playwright E2E (separate change).
- Performance / throughput benchmarking (future work).
- Modifying `tests/env/docker-compose.yml`, any source file, or any Helm chart.

## Decisions

### D1: Env-var-only backend swap

**Decision**: The SeaweedFS endpoint is provided by overriding `S3_ENDPOINT` (and credentials) at test-runner invocation time; `tests/env/env.sh` is consumed read-only.

**Rationale**: Matches the existing convention (`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` already exported there). No harness code changes needed; CI can set the vars to point at SeaweedFS without touching docker-compose.

**Alternative considered**: A separate docker-compose override file. Rejected because it couples the validation change to the infra layer and requires an additional file outside `openspec/`.

### D2: Checksum manifest as parity source-of-truth

**Decision**: The parity checker consumes the checksum manifest produced by `add-seaweedfs-data-migration-runbook` (object key + ETag per bucket). It does not re-read the MinIO source directly unless the manifest is absent.

**Rationale**: Re-reading MinIO at cutover time risks detecting objects written AFTER the migration snapshot, producing false positives. The manifest captures the authoritative migration snapshot.

**Alternative considered**: Live diff (MinIO ListObjects vs SeaweedFS ListObjects). Retained as fallback mode when no manifest is present.

### D3: Two-tenant fixture alignment

**Decision**: The smoke suite provisions tenants A and B using the same fixture convention as the existing `tests/env/` flows (e.g., `flows-tenant-cascade.test.mjs`). The cross-tenant probe is a NEGATIVE assertion (A must be denied on B's bucket).

**Rationale**: Consistent with the repo's isolation-probe convention; maximises reuse of existing tenant-provisioning helpers.

### D4: Fail-closed on parity discrepancy

**Decision**: The parity checker exits non-zero and prints a structured report (missing keys, checksum mismatches) on any discrepancy not present in a reviewed exception list. A zero exit means 100% parity.

**Rationale**: Makes CI integration straightforward (exit code = gate). Exception list is explicit and auditable.

## Risks / Trade-offs

- [ETag mismatch on multipart uploads] SeaweedFS may compute ETags differently than MinIO for multipart objects → Mitigation: document the known SeaweedFS ETag algorithm; accept MD5-of-parts format in the exception list pattern; verify with a known multipart object in the smoke fixture.
- [Tenant fixture teardown] If the validation run aborts mid-way, tenant-B bucket may remain accessible cross-tenant → Mitigation: teardown hook (same pattern as `tests/env/down.sh`).
- [SeaweedFS IAM not yet wired] Cross-tenant denial relies on per-tenant S3 credentials; if `add-seaweedfs-tenant-identities` is not deployed, the negative probe cannot run → Mitigation: the parity checker and API smoke are independently runnable; the negative probe is skipped (logged) if per-tenant creds are absent.

## Open Questions

- OQ1: Does the `add-seaweedfs-data-migration-runbook` manifest use ETag or SHA-256? The parity checker must match the format. Resolve before implementing D2.
- OQ2: SeaweedFS S3 gateway port in the `tests/env/` harness — confirm it does not collide with the MinIO port 59000.
