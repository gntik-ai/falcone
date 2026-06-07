## Design

### Scope

Two modules are modified; no new dependencies outside the Node built-in `node:path` module.

- `services/adapters/src/storage-bucket-object-ops.mjs` — Layer 1: syntactic rejection in `assertObjectKey`.
- `services/adapters/src/storage-logical-organization.mjs` — Layer 2: defense-in-depth containment assertion in `buildStorageObjectOrganization`.

### Layer 1 — assertObjectKey extension

`assertObjectKey` is the single entry point for all storage operations that accept an `objectKey` parameter. The existing checks (type, empty, leading slash, length) are preserved. Three new checks are appended in order:

1. **Backslash check**: `objectKey.includes('\\')` — O(n) string scan, fast path.
2. **Control-character check**: iterate over `charCodeAt(i)` for each position; reject if `code <= 0x1f || code === 0x7f`. Implemented as an explicit loop over char codes rather than a regex literal to avoid editor/transport mangling of control-character literals in the source file.
3. **Dot-dot segment check**: `objectKey.split('/')` then check each segment against `'..'`. A segment of `'.'` is intentionally not rejected here — it does not escape a prefix and is consistent with S3/GCS key semantics. Only `'..'` segments are blocked.

All three conditions throw `new Error(STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY)`, consistent with the existing validator.

### Layer 2 — buildStorageObjectOrganization containment assertion

After `canonicalObjectPath` is computed by concatenating `objectPrefix` with the normalized object key, `posix.normalize` (from `node:path`) is applied to collapse any residual `..` or `.` segments. The normalized result is then asserted to `startsWith(objectPrefix)`.

This check is independent of `assertObjectKey` — it would catch traversal sequences that somehow bypass Layer 1 (e.g., from a future code path that does not call `assertObjectKey`, or a backend that decodes percent-encoded sequences before returning a path). On failure it throws `new Error('INVALID_OBJECT_KEY')`, aborting before any storage I/O.

The `posixPath` import (`import { posix as posixPath } from 'node:path'`) is placed at the top of the file to match the module's ESM style. No third-party dependencies are added.

### Call graph — validation is applied uniformly

`assertObjectKey` is called from `buildStorageObjectRecord` (line 316 of the pre-patch file). Every higher-level public function (`previewStorageObjectUpload`, `previewStorageObjectDownload`, `previewStorageObjectDeletion`, `buildStorageObjectMetadata`, `buildStorageObjectCollection`) ultimately calls `buildStorageObjectRecord`, so all storage operations that accept `objectKey` inherit the new validation uniformly without further changes.

### Test strategy

Black-box tests in `tests/blackbox/storage-object-key-traversal.test.mjs` exercise the public exports directly:
- `bbx-storage-traversal-01/02/06/07`: traversal key rejected on create, upload preview, download preview, delete preview.
- `bbx-storage-traversal-03`: legitimate nested key (`uploads/2026/report.pdf`) is accepted.
- `bbx-storage-traversal-04`: backslash key rejected.
- `bbx-storage-traversal-05`: NUL-byte key rejected.
- `bbx-storage-traversal-assert-*`: direct tests of the exported `assertObjectKey` for each new rule and for valid keys.
