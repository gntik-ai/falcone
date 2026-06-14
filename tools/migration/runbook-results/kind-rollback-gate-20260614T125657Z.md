# Non-prod rollback validation gate — result

Change: `add-seaweedfs-rollback-plan` (#438), runbook `tools/migration/ROLLBACK.md` §4.

| Field | Value |
|-------|-------|
| Environment | kind `test-cluster-b`, namespace `falcone` (non-prod) |
| Date (UTC) | 2026-06-14 12:56 |
| Executor | Andrea Mucci |
| Rollback target (S3) | MinIO `falcone-storage:9000` (port-forwarded to `localhost:59000`) |
| Backend role under test | `STORAGE_S3_ENDPOINT` re-pointed to the retained MinIO endpoint (rollback re-point) |
| Metadata store | local throwaway Postgres (tests/env schema; no cluster-DB mutation) |
| Command | `S3_ENDPOINT=http://localhost:59000 S3_ACCESS_KEY=*** S3_SECRET_KEY=*** bash tests/env/validation/run-validation.sh` |
| `run-validation.sh` exit | `0` |
| smoke-storage | **PASS** |
| parity-check | SKIPPED (no `MIGRATION_MANIFEST`/`SOURCE_S3_ENDPOINT`; parity is a cutover concern, not the re-point gate) |
| cross-tenant probe | skipped (per-tenant S3 identities are a SeaweedFS feature; MinIO target uses a single root credential) |
| **Result** | ✅ **GREEN** |

## Per-tenant route results (against kind MinIO)

| Tenant | listBuckets | provisionBucket | workspaceUsage | listObjects | objectMetadata |
|--------|-------------|-----------------|----------------|-------------|----------------|
| ten-a | 200 | 201 | 200 | 200 | 200 |
| ten-b | 200 | 201 | 200 | 200 | 200 |

Real S3 I/O confirmed: each tenant's bucket was provisioned (201) and a probe object
written/read back (list + metadata 200) on the cluster MinIO.

## Notes

- This certifies the **rollback re-point procedure** (`ROLLBACK.md` §3 steps 2–4): with
  Falcone's storage endpoint pointed at the retained MinIO, the per-tenant storage API is
  green. It does NOT assert SeaweedFS→MinIO data completeness (covered by the cutover
  data-migration runbook / parity check).
- Gate artifacts left in the cluster MinIO: buckets `val-ten-a-bucket`, `val-ten-b-bucket`
  (one ~25-byte probe object each). Idempotent fixtures — a re-run reuses them. Remove with
  `mc rb --force` if a clean teardown is required.
- Decommission (`ROLLBACK.md` §5) is now **unblocked by this gate** but still requires the
  rollback window to have elapsed; it remains a live operator step at the real cutover.
