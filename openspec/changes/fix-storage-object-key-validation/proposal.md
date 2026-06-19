# fix-storage-object-key-validation

## Change type
bugfix

## Capability
storage

## Priority
P2

## Why
The four object handlers in `deploy/kind/control-plane/storage-handlers.mjs` —
`storageGetObject`, `storagePutObject`, `storageDeleteObject`, and
`storageObjectMetadata` — passed the decoded object key received from the URL
directly to the S3/SeaweedFS backend over SigV4 without any prior validation.
A path-traversal key such as `../../etc/passwd` (or the URL-encoded form
`..%2F..%2Fetc%2Fpasswd`) was forwarded verbatim; the backend rejected the
malformed path and that rejection was mapped to a 5xx
`STORAGE_GET_FAILED`/`STORAGE_PUT_FAILED`/`STORAGE_DELETE_FAILED`/`STORAGE_METADATA_FAILED`
response, surfacing to the caller as HTTP 502. No data escaped the bucket —
it is an error-handling defect — but a caller could confirm object-key formats
that trigger different backend behaviour and the error class is incorrect.

The platform adapter layer already enforces an `assertObjectKey` guard in
`services/adapters/src/storage-bucket-object-ops.mjs`, but the kind
control-plane runtime does not share that path. GitHub issue #638.

## What Changes
A new `decodeObjectKey()` helper added to `deploy/kind/control-plane/storage-handlers.mjs`
validates and normalises the key BEFORE any backend or DB call, rejecting:
- `..` path segments (path traversal)
- a leading `/`
- backslash characters
- ASCII control characters
- an empty key or a key longer than 1024 characters
- malformed percent-encoding that cannot be decoded

All four object handlers (`storageGetObject`, `storagePutObject`,
`storageDeleteObject`, `storageObjectMetadata`) call `decodeObjectKey()` as the
first step — before the bucket-ownership gate — and return `400 INVALID_OBJECT_KEY`
on any violation. The validation policy mirrors `assertObjectKey` in
`services/adapters/src/storage-bucket-object-ops.mjs`.

## Impact
- Path-traversal and malformed-key requests now return `400 INVALID_OBJECT_KEY`
  instead of `502 STORAGE_*_FAILED`.
- Validation runs before the bucket-ownership database query, so the new 400
  is cheaper and does not depend on tenant context.
- Valid keys (including nested paths with a single `/`) are unaffected.
- Affected spec: `storage`.
