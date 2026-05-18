## Why

The storage adapter's `buildPresignedUrlRecord` returns a "presigned URL"
reference that is neither cryptographically signed nor enforced against the
stamped `expiresAt`. From `openspec/audit/cap-g1-object-storage-adapter.md`:

- **B3** (`services/adapters/src/storage-multipart-presigned.mjs:567`) — the
  `presignedUrlRef` is computed via
  `buildOpaqueReference('psu', \`${tenantId}:${workspaceId}:${bucketId}:${objectKey}:${operation}:${generatedAt.toISOString()}\`)`,
  a deterministic base64-style string from inputs. **No HMAC, no secret, no
  signature.** The record carries `expiresAt` but the adapter contract does
  not require any caller to enforce it; if the executor consumes the record
  without validating `expiresAt`, the URL is usable forever.
- **G25** (`storage-multipart-presigned.mjs:567` + S7 contract) — server-side
  enforcement of `expiresAt` is delegated to "the caller" but no contract
  defines who that caller is.

## What Changes

- Replace `buildOpaqueReference` with an HMAC-SHA256 signature over the
  canonical tuple `(tenantId, workspaceId, bucketId, objectKey, operation,
  generatedAt, expiresAt, signingKeyId)`. The signing key MUST come from
  a configured `presignedUrlSigningKey` context input — never from a
  hard-coded constant.
- Add `signature`, `signatureAlgorithm: 'HMAC-SHA256'`, and `signingKeyId`
  to the returned record; keep `presignedUrlRef` as a stable opaque id for
  audit correlation but mark it as non-authoritative.
- Add `verifyPresignedUrlRecord(record, { signingKey, now })` that recomputes
  the signature, validates `now < expiresAt`, and returns
  `{valid: boolean, reasonCode}`. Document the executor contract that
  every consumer MUST call this before fulfilling the request.
- Reject `grantedTtlSeconds` exceeding a configurable
  `MAX_PRESIGNED_TTL_SECONDS` (default 7 days, matching S3 standard).

## Capabilities

### Modified Capabilities

- `data-services`: requirement that presigned URLs are HMAC-signed, that
  `expiresAt` is enforceable by every consumer, and that TTLs are bounded.

## Impact

- **Affected code**: `services/adapters/src/storage-multipart-presigned.mjs`
  (`buildPresignedUrlRecord` at `:547-579` and the URL-ref builder at `:567`),
  `services/adapters/src/storage-error-taxonomy.mjs` (new
  `PRESIGNED_SIGNATURE_INVALID`, `PRESIGNED_EXPIRED`, `PRESIGNED_TTL_EXCEEDED`),
  `tests/adapters/storage-multipart-presigned.test.mjs`.
- **Migration required**: presigned-URL signing key must be provisioned for
  every tenant; key rotation lifecycle is in the same secrets-management
  family as the programmatic-credential rotation work.
- **Breaking changes**: every executor that consumes the adapter's presigned-URL
  record must invoke `verifyPresignedUrlRecord` before fulfilling the request.
  Existing executors that relied on the URL being intrinsically authoritative
  must be updated.
- **Out of scope**: provider-native presigned URLs from MinIO/Ceph/Garage
  (the adapter's record is a planning envelope; the provider issues its own
  signed URL when the executor calls it).
