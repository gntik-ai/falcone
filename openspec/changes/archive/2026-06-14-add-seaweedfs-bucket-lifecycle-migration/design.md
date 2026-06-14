## Context

Falcone's storage capability currently supports three coexisting tenant-to-bucket mapping strategies:

1. **bucket-per-workspace** via the `workspace_buckets` Postgres table (`deploy/kind/control-plane/tenant-store.mjs:67-75`) — the only strategy exercised against a real backend (kind runtime).
2. **prefix-per-tenant** in the modeling layer (`services/adapters/src/storage-logical-organization.mjs`).
3. **`<tenantId>-` name-prefix** in the config collector (`services/provisioning-orchestrator/src/collectors/s3-collector.mjs:74-75`).

Lifecycle/policy/CORS/versioning applier calls exist (`services/provisioning-orchestrator/src/appliers/storage-applier.mjs`) but are unwired. SeaweedFS support for these is partial and version-dependent, as catalogued in the adr-spike compatibility matrix. Migrating object storage to SeaweedFS requires reconciling all of this against a single canonical model before any data migration occurs.

## Goals / Non-Goals

**Goals:**

- Declare `workspace_buckets` + bucket-per-workspace as the single canonical tenant-to-bucket mapping; document that the other two strategies are legacy pending convergence.
- Implement an idempotent bucket reconciliation step: for each row in `workspace_buckets` plus any discovered MinIO bucket, ensure the bucket exists on SeaweedFS with the same DNS-sanitized name.
- Wire the existing applier calls through a SeaweedFS compatibility gate that recreates supported config (lifecycle, policy, CORS, versioning) and records an explicit gap decision for each PARTIAL/UNSUPPORTED setting.
- Expose a dry-run mode that outputs the full list of planned bucket-create and config-apply actions without executing any write.
- Preserve `workspace_buckets` row validity post-migration (same names, same workspace associations).
- Enforce per-tenant bucket isolation: the reconciliation step verifies no bucket is reachable across tenant boundaries.

**Non-Goals:**

- Copying object data (belongs in `data-migration-runbook` change).
- Post-migration data integrity / parity verification (belongs in `migration-validation` change).
- Changing per-tenant storage credential identities (belongs in `add-per-tenant-identities` change).
- Full lifecycle feature parity on SeaweedFS beyond what the adr-spike matrix confirms.

## Decisions

### D1 — Canonical mapping: bucket-per-workspace backed by `workspace_buckets`

**Rationale:** It is the only mapping with a real backend exercised in tests (`tenant-store.mjs:67-75`). It gives a 1-to-1 bucket name to workspace association, making `workspace_buckets` the authoritative source of truth for reconciliation. The prefix-per-tenant and `<tenantId>-` prefix strategies are convergent legacy; they are retired (not deleted at this stage) but no new code paths will use them.

**Alternative considered:** Prefix-per-tenant (single bucket, prefixed keys). Rejected because it complicates per-bucket ACL/lifecycle rules and requires application-layer key rewriting, adding risk.

### D2 — Idempotent reconciliation via HEAD-then-create

The reconciliation step issues a `headBucket` call for each expected bucket; if the bucket does not exist it issues `createBucket`. If the bucket already exists (idempotent re-run), it is left unchanged. Bucket names are validated against the DNS rule `[a-z0-9-]`, 3–63 chars (`storage-handlers.mjs:182-184`) before any call.

### D3 — Lifecycle/config gate driven by adr-spike compatibility matrix

Rather than attempting to apply all four config types blindly, the reconciliation step consults a static compatibility map (populated from the adr-spike matrix artifact) per SeaweedFS version. For each config type:

- **SUPPORTED** — apply via the existing applier call.
- **PARTIAL** — apply the supported subset; log a structured warning naming the omitted fields and the chosen shim (e.g., TTL rules supported, filter predicates dropped).
- **UNSUPPORTED** — log a structured warning with `decision: "drop"` and skip; no silent loss.

**Alternative considered:** Fail-fast on any unsupported config. Rejected because it would block the migration entirely for tenants with CORS/versioning settings that SeaweedFS does not support, when those settings are non-critical.

### D4 — Dry-run mode via a `--dry-run` flag on the migration CLI entry point

Dry-run collects all planned actions (bucket creates + config applies) into a list and prints them as structured JSON/YAML without executing any S3/SeaweedFS write. The same code path is exercised; only the final dispatch is gated.

### D5 — Tenant isolation enforced by workspace-scoped IAM policy post-create

After each bucket is created, the reconciliation step applies a bucket policy that restricts access to the owning workspace's IAM identity. This reuses the `putBucketPolicy` applier call. Cross-tenant access is validated by attempting a `headBucket` from a different tenant's credential; the attempt must return 403.

## Risks / Trade-offs

- **[Risk] `workspace_buckets` is incomplete (buckets exist in MinIO but have no row)** → Mitigation: the collector step (`s3-collector.mjs`) discovers existing MinIO buckets; reconciliation merges discovered buckets into the plan, inserting missing `workspace_buckets` rows before applying to SeaweedFS.
- **[Risk] DNS-sanitized name collision** → Mitigation: reconciliation validates names before creating; if two workspace names produce the same sanitized bucket name, the step halts and reports a conflict requiring manual resolution.
- **[Risk] SeaweedFS `putBucketLifecycleConfiguration` support varies by version** → Mitigation: adr-spike matrix gates the call; the reconciliation step records the SeaweedFS version at migration time in the gap log.
- **[Risk] Partial config apply leaves a bucket in an inconsistent state** → Mitigation: config apply is transactional per bucket (all or explicit-drop); the gap log captures the final state for each bucket.

## Migration Plan

1. Ensure `add-seaweedfs-deployment` and `add-seaweedfs-storage-provider` are applied (preconditions).
2. Run reconciliation in **dry-run mode**: review planned bucket creates and config applies.
3. Resolve any name-collision conflicts surfaced by dry-run.
4. Run reconciliation in **apply mode**: buckets created, config applied or gap-logged.
5. Verify `workspace_buckets` rows still resolve to existing SeaweedFS buckets (spot-check).
6. Hand off to `data-migration-runbook` for object data copy.

**Rollback:** The reconciliation step does not delete buckets or rows. Re-running against MinIO is safe (same idempotent HEAD-then-create logic applies).

## Open Questions

- Exact SeaweedFS version deployed by `add-seaweedfs-deployment` — determines which adr-spike matrix row to use for the compatibility gate. Must be confirmed before apply.
- Whether `workspace_buckets` rows for deleted workspaces should be skipped or cleaned up during reconciliation. Recommend skip-and-log for safety; cleanup is a separate lifecycle concern.
