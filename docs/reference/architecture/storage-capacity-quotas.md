# Storage capacity quotas (bucket count and total bytes)

Per-workspace storage capacity is bounded by two quota dimensions enforced in the control-plane
storage handlers: a **bucket-count** limit and an optional **total-bytes** limit. When a request
would exceed a configured limit it is rejected with `409 STORAGE_QUOTA_EXCEEDED`, and the workspace
usage API reports the effective limit and remaining capacity for each dimension.

Quota is a per-workspace governance control, layered on top of (and after) the existing
tenant/workspace ownership gates. It is **not** a tenant-isolation boundary, so enforcement
**fails open** (allows the operation) if the quota model or its inputs are unavailable — a
governance fault never blocks a legitimate storage operation.

## Configuration

The effective limits are deployment environment variables on the control-plane runtime, with safe
defaults:

| Variable | Dimension | Default | Meaning |
| --- | --- | --- | --- |
| `STORAGE_MAX_BUCKETS` | bucket count, per workspace | `8` | Maximum buckets a single workspace may provision. The default matches the product governance default `DEFAULT_STORAGE_BUCKET_LIMIT`. |
| `STORAGE_MAX_BYTES` | total stored bytes, per workspace | unset (unlimited) | Maximum total object bytes across all of a workspace's buckets. When **unset**, byte enforcement is off and the upload path performs **no** usage scan. |

A malformed value (non-numeric or negative) collapses that dimension to *unlimited* rather than
failing the request — fail open.

## Bucket-count admission

`POST /v1/storage/workspaces/{workspaceId}/buckets` (gateway operation `createStorage`,
`POST /v1/storage/buckets`) counts the caller's current workspace buckets **before** creating the
physical bucket. If provisioning one more would exceed `STORAGE_MAX_BUCKETS`, the request is
rejected with `409 STORAGE_QUOTA_EXCEEDED` and no bucket is created. The ownership `404` gate still
runs first, so a non-owner receives `404` (no existence leak), never `409`.

## Byte (total-bytes) admission

When `STORAGE_MAX_BYTES` is configured, `PUT /v1/storage/buckets/{bucketId}/objects/{objectKey}`
(gateway operation `uploadStorageObject`) computes the workspace's current total bytes (summing
objects across the workspace's buckets, the same scan the usage API uses) plus the size of the
incoming object — which is already buffered at the control-plane layer. If the result would exceed
the limit, the upload is rejected with `409 STORAGE_QUOTA_EXCEEDED` and the object is not stored.
When `STORAGE_MAX_BYTES` is unset, this scan is skipped entirely and uploads are never rejected for
total-bytes capacity.

## Usage reporting

`GET /v1/storage/workspaces/{workspaceId}/usage` reports each dimension as a
`StorageUsageDimensionStatus` with `used`, `limit`, `remaining`, and `utilizationPercent`:

- `bucketCount` always reports a non-null `limit` (the effective `STORAGE_MAX_BUCKETS`).
- `totalBytes` and `objectSizeBytes` report a non-null `limit` only when `STORAGE_MAX_BYTES` is
  configured; otherwise `limit` is `null`, denoting *unlimited*.
- `objectCount` has no configured limit and reports `limit: null`.
- For a limited dimension: `remaining = max(limit - used, 0)` and
  `utilizationPercent = round(used / limit * 100)`. For an unlimited dimension, `remaining` and
  `utilizationPercent` are `null` (so the API never reports a perpetual `null` when a limit is set).

## Error contract

`STORAGE_QUOTA_EXCEEDED` is returned as a standard `ErrorResponse` body with HTTP status `409` on
both the bucket-provision and (when byte enforcement is active) the object-upload operations. The
status and code are additive to those operations and backward compatible — no existing field,
status code, or success shape changes.

## Implementation

- `deploy/kind/control-plane/storage-quota.mjs` — pure, injectable quota-decision helpers
  (`checkBucketQuota`, `checkByteQuota`, `usageLimits`, `dimensionStatus`). The kind-runtime image
  cannot statically import the product `services/adapters` package, so the trivial admission math
  (`used + delta > limit`) is inlined here while reusing the product's canonical error code
  `STORAGE_QUOTA_EXCEEDED` and default bucket limit `8`.
- `deploy/kind/control-plane/storage-handlers.mjs` — `storageProvisionBucket` (bucket admission),
  `storagePutObject` (byte admission), and `storageWorkspaceUsage` (limit/remaining/utilization
  reporting) consume those helpers.
