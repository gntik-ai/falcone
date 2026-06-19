# Tasks — fix-storage-object-key-validation

## Reproduce (test-first)
- [x] Added failing black-box test
  `tests/blackbox/storage-handlers-object-key-validation.test.mjs`
  (`bbx-objkey-live-01..03`) that drives `storageGetObject`, `storagePutObject`,
  `storageDeleteObject`, and `storageObjectMetadata` in
  `deploy/kind/control-plane/storage-handlers.mjs` directly (no backend call) and
  asserts:
  - A path-traversal key (`../../etc/passwd`) and URL-encoded form
    (`..%2F..%2Fetc%2Fpasswd`) returns 400 `INVALID_OBJECT_KEY`, never 502 or any
    5xx, from all four object handlers.
  - A backslash key and a leading-slash key each return 400 `INVALID_OBJECT_KEY`.
  - Malformed percent-encoding (`key%GGname`) returns 400 rather than 500.
  - A valid nested key (`folder/object.bin`) is accepted without error (no false
    positive).
  The test was RED while the handler passed the key unvalidated to the S3 backend.

## Implement
- [x] `deploy/kind/control-plane/storage-handlers.mjs`: added exported
  `decodeObjectKey(rawKey)` helper that rejects `..` segments, a leading `/`,
  backslashes, ASCII control characters, an empty or over-1024-character key, and
  malformed percent-encoding — returning `{ error: 'INVALID_OBJECT_KEY', status: 400 }`
  on violation and `{ key: decodedKey }` on success. Updated `storageGetObject`,
  `storagePutObject`, `storageDeleteObject`, and `storageObjectMetadata` to call
  `decodeObjectKey()` as the very first step (before the bucket-ownership gate).
  The validation policy mirrors `assertObjectKey` in
  `services/adapters/src/storage-bucket-object-ops.mjs`.

## Verify
- [x] `tests/blackbox/storage-handlers-object-key-validation.test.mjs` passes
  (`bbx-objkey-live-01..03`, 3/3 GREEN). No backend call is made for rejected keys.
- [x] `bash tests/blackbox/run.sh` — full black-box suite green (997 pass); the
  pre-existing `storage-object-key-traversal.test.mjs` (adapter builder path) is
  unchanged and still green.

## Archive
- [ ] `openspec validate fix-storage-object-key-validation --strict`; archive after merge.
