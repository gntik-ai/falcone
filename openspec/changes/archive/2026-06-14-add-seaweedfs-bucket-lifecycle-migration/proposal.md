## Why

Falcone's storage layer carries three coexisting tenant-to-bucket mapping strategies (`workspace_buckets` table, prefix-per-tenant, and `<tenantId>-` name prefix) that diverge across the kind runtime, the modeling layer, and the provisioning collector. Migrating object storage from MinIO to SeaweedFS requires a single idempotent reconciliation step that recreates every bucket/prefix on the new backend using one canonical mapping, and that handles lifecycle/policy/CORS/versioning settings whose SeaweedFS support is only partial — without silently dropping any declared configuration.

## What Changes

- Canonicalize the tenant-to-bucket mapping as **bucket-per-workspace** backed by the `workspace_buckets` Postgres table (the only strategy exercised against a real backend), and retire the prefix-per-tenant and `<tenantId>-` prefix strategies as legacy.
- Add an idempotent bucket reconciliation step that creates every workspace bucket on SeaweedFS from the `workspace_buckets` source of truth, preserving DNS-sanitized bucket names (pattern `[a-z0-9-]`, 3–63 chars).
- For each declared lifecycle/policy/CORS/versioning setting, recreate it on SeaweedFS where the adr-spike lifecycle support matrix confirms support; for PARTIAL or UNSUPPORTED settings, record the gap and the chosen shim/drop decision — no silent loss.
- Expose a **dry-run mode** that lists all planned bucket and lifecycle actions before any write is applied.
- Keep `workspace_buckets` rows valid after migration (same bucket names) so no application-layer change is required.
- Enforce per-tenant bucket isolation: no bucket is reachable across tenant boundaries after recreation.

## Capabilities

### New Capabilities

- `storage-migration`: Idempotent bucket/prefix recreation on SeaweedFS from the canonical `workspace_buckets` source of truth, lifecycle/policy/CORS/versioning reconciliation with explicit gap handling, dry-run mode, and post-migration tenant isolation enforcement.

### Modified Capabilities

- `storage`: ADDED requirements covering the canonical tenant-to-bucket mapping contract, bucket recreation idempotency guarantees, lifecycle/config recreation rules for SeaweedFS, and dry-run listing behaviour.

## Impact

- `deploy/kind/control-plane/tenant-store.mjs` (lines 67-75) — canonical `workspace_buckets` read path; drives reconciliation source of truth.
- `deploy/kind/control-plane/storage-handlers.mjs` (lines 182-184) — DNS-sanitization rule for bucket names; governs valid name space on SeaweedFS.
- `services/adapters/src/storage-logical-organization.mjs` — prefix-per-tenant strategy; to be converged/retired.
- `services/provisioning-orchestrator/src/collectors/s3-collector.mjs` (lines 74-75) — `<tenantId>-` prefix strategy; to be converged/retired.
- `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` — currently unwired `putBucketLifecycleConfiguration`, `putBucketPolicy`, `putBucketCors`, `putBucketVersioning` calls; wired into the new reconciliation step.
- Depends on: `add-seaweedfs-deployment` (SeaweedFS running), `add-seaweedfs-storage-provider` (provider/client), adr-spike (lifecycle support matrix).
- Blocks: `data-migration-runbook`, `migration-validation`.
- No object data is copied (out of scope); no credential identity changes (out of scope, see `add-per-tenant-identities`).
