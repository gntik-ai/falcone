## Why

`services/adapters/src/storage-bucket-object-ops.mjs::assertObjectKey:50-59` is the sole syntactic validator for object keys and checks only type, empty string, leading slash, and length — it contains no check for `..` path segments, backslashes, or control/NUL characters. A key such as `../../tenants/<B>/workspaces/<wsB>/shared/secret` passes all four conditions. `services/adapters/src/storage-logical-organization.mjs::buildStorageObjectOrganization:154-158` then concatenates the untrusted key directly onto the workspace prefix (`canonicalObjectPath = \`${objectPrefix}${normalizedObjectKey}\``) without post-concatenation normalization or containment check. `services/adapters/src/storage-logical-organization.mjs::trimSlash:31-33` strips only leading/trailing slashes and does not normalize `..`. If the storage backend normalizes `..` segments, the effective address escapes the caller's workspace prefix, enabling cross-tenant object reads and writes. Even where the backend stores `..` literally, quota attribution and audit scoping at lines 168-169 are broken. A codebase-wide grep for `..`, `path.normalize`, `path.resolve`, or `traversal` across `services/adapters/src/storage-*.mjs` returns zero matches (bug-011).

## What Changes

- `assertObjectKey` MUST reject any key that contains a `..` path segment (i.e., a segment equal to `..` when the key is split on `/`), a backslash (`\`), or a control character (0x00–0x1F, 0x7F), throwing `INVALID_OBJECT_KEY`.
- `buildStorageObjectOrganization` MUST, after computing `canonicalObjectPath`, normalize the path and assert it begins with `objectPrefix`; a containment failure MUST throw `INVALID_OBJECT_KEY` as defense-in-depth independent of backend behavior.
- Legitimate keys using forward slashes as directory separators MUST continue to succeed.

## Capabilities

### New Capabilities

- `storage`: Tenant-scoped object-key validation and workspace-prefix containment check, ensuring object keys cannot escape the caller's workspace prefix via path traversal sequences.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the storage capability spec -->

## Impact

- `services/adapters/src/storage-bucket-object-ops.mjs::assertObjectKey:50-59` — MODIFIED: extended to reject `..` segments, backslashes, and control characters.
- `services/adapters/src/storage-logical-organization.mjs::buildStorageObjectOrganization:154-158` — MODIFIED: post-concatenation containment assertion added.
- All storage operations accepting `objectKey` (CRUD, presigned URLs, list, delete) benefit from both layers.
- Black-box suite: new test confirming traversal keys return HTTP 400 `INVALID_OBJECT_KEY`.
