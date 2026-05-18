## Why

The storage capacity-quota engine misclassifies every violation as
`storage_buckets`, races on concurrent writes, and never updates the
multipart accumulator that completion would otherwise cross-check. From
`openspec/audit/cap-g1-object-storage-adapter.md`:

- **B4** (`services/adapters/src/storage-capacity-quotas.mjs:555`) — both
  branches of the `dimensionId` ternary return `'storage_buckets'`. Object-size,
  object-count, and total-byte violations are all reported with
  `dimensionId: 'storage_buckets'`; downstream dashboards and alerts treat
  every storage quota breach as a bucket-count breach.
- **B8** (`storage-capacity-quotas.mjs:507-549`) — snapshot read-then-write
  with no transactional lock; concurrent puts can both pass the quota check
  even when the second would exceed the limit.
- **B12** (`services/adapters/src/storage-multipart-presigned.mjs:279`) —
  the multipart session's `accumulatedSizeBytes` is initialised to 0 but
  never updated as parts are uploaded; the completion preview computes total
  from the part list, not from session state, so quota enforcement during the
  upload sequence is impossible.
- **G19** (`storage-capacity-quotas.mjs:507-549`) — no transactional guard.
- **G21** (`storage-capacity-quotas.mjs:555`) — `dimensionId` is hard-coded.

## What Changes

- Replace the no-op ternary at `storage-capacity-quotas.mjs:555` with a
  per-dimension switch mapping `STORAGE_QUOTA_DIMENSIONS.BUCKET_COUNT →
  'storage_buckets'`, `.OBJECT_COUNT → 'storage_objects'`,
  `.TOTAL_BYTES → 'storage_total_bytes'`,
  `.OBJECT_SIZE_BYTES → 'storage_object_size_bytes'`.
- Move the quota check + counter increment into a single
  `claimStorageQuotaCapacity()` helper that takes an executor-supplied
  transactional context (`SELECT … FOR UPDATE` on the per-tenant quota row,
  or an equivalent advisory lock). The compiler defines the contract; the
  executor implements the lock.
- Update `accumulatedSizeBytes` on each multipart part record so the session
  carries an authoritative running total; completion still cross-checks
  against the part list.

## Capabilities

### Modified Capabilities

- `data-services`: requirement on storage quota dimensionId correctness,
  transactional quota claim, and multipart accumulator integrity.

## Impact

- **Affected code**: `services/adapters/src/storage-capacity-quotas.mjs`
  (violation builder at `:551-555`, quota check at `:507-549`),
  `services/adapters/src/storage-multipart-presigned.mjs:258-284` (session
  init) and `:279` (accumulator update site), plus the matching test files.
- **Migration required**: none in this adapter (compiler change); the executor
  side needs to acquire the per-tenant quota lock, which is out of scope here.
- **Breaking changes**: dashboards and alerting that grouped every storage
  quota breach under `storage_buckets` will start to see the real dimension
  ids; downstream alert rules must be updated.
- **Out of scope**: alerting/dashboard remediation (covered downstream of
  `harden-m4-quota-vocabulary-alignment`); presigned URL signing (covered by
  `fix-g1-presigned-url-signature`).
