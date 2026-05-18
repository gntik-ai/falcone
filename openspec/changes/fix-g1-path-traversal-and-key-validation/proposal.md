## Why

`assertObjectKey` in the storage adapter is the only validation guarding the
path that downstream helpers concatenate into a canonical object path. It does
not reject the metacharacters that allow workspace-prefix escape. From
`openspec/audit/cap-g1-object-storage-adapter.md`:

- **B2** (`services/adapters/src/storage-bucket-object-ops.mjs:50-59`) —
  `assertObjectKey` checks `typeof === 'string'`, non-empty after trim, no
  leading `/`, and `length <= 1024`. There is **no `..` check, no `\0` filter,
  no control-char filter, no backslash filter.** Combined with the path
  construction `${objectPrefix}${normalizedObjectKey}` in
  `storage-logical-organization.mjs:158`, an attacker submitting
  `../../other_workspace/secret` produces a `canonicalObjectPath` that escapes
  the workspace prefix. S3-compatible providers may normalise paths server-side,
  but the adapter offers no defence.
- **G14** (`storage-bucket-object-ops.mjs:50-59`) — no adversarial test for
  `..`, null bytes, or backslashes.
- **G15** (`storage-bucket-object-ops.mjs:50-59` cross-referenced with
  `storage-logical-organization.mjs:158`) — object-ops trusts upstream
  tenant/workspace; a malformed objectKey escapes the workspace prefix at the
  logical-organization layer.

## What Changes

- Extend `assertObjectKey` to reject:
  - any occurrence of `..` as a path segment (whether `../`, `/..`, or
    `foo/../bar`);
  - any null byte (`\0`) or ASCII control character (0x00-0x1F, 0x7F);
  - any backslash (`\\`);
  - any leading or trailing whitespace beyond what `trim()` removes.
- Add a defence-in-depth check inside `storage-logical-organization.mjs` that
  asserts the resolved `canonicalObjectPath` starts with the expected
  `tenants/{tenantId}/workspaces/{workspaceId}/` prefix and throws
  `OBJECT_KEY_ESCAPES_WORKSPACE` if not.
- Stamp new error codes `INVALID_OBJECT_KEY_TRAVERSAL`,
  `INVALID_OBJECT_KEY_CONTROL_CHAR`, `INVALID_OBJECT_KEY_BACKSLASH`,
  `OBJECT_KEY_ESCAPES_WORKSPACE` in the storage error taxonomy.

## Capabilities

### Modified Capabilities

- `data-services`: requirement on object-key validation and workspace-prefix
  escape detection.

## Impact

- **Affected code**: `services/adapters/src/storage-bucket-object-ops.mjs:50-59`,
  `services/adapters/src/storage-logical-organization.mjs:158`,
  `services/adapters/src/storage-error-taxonomy.mjs` (new codes),
  `tests/adapters/storage-bucket-object-ops.test.mjs`.
- **Migration required**: none — compiler-only change.
- **Breaking changes**: existing buckets whose object keys legitimately
  contain backslashes (rare on S3-compatible providers but legal on local
  Windows-origin uploads) will be rejected. A one-line per-tenant escape
  hatch is out of scope for this proposal; document the deprecation in the
  adapter README.
- **Out of scope**: end-to-end path-traversal exploitation against MinIO/Ceph/
  Garage (those providers normalise paths server-side); presigned URL signing
  (covered by `fix-g1-presigned-url-signature`).
