## 1. Failing tests

- [ ] 1.1 [test] Add cases to `tests/adapters/storage-bucket-object-ops.test.mjs`
      asserting `assertObjectKey` rejects each of: `'../escape'`, `'foo/../bar'`,
      `'/..'`, `'foo\0bar'`, `'foo\x01bar'`, `'foo\\bar'` with the appropriate
      error codes (proves B2 at
      `services/adapters/src/storage-bucket-object-ops.mjs:50-59`).
- [ ] 1.2 [test] Add a case asserting `buildCanonicalObjectPath` throws
      `OBJECT_KEY_ESCAPES_WORKSPACE` if a hand-crafted resolved path does not
      start with the expected tenant/workspace prefix (defence-in-depth at
      `storage-logical-organization.mjs:158`).

## 2. Implementation

- [ ] 2.1 [fix] Extend `assertObjectKey` at `storage-bucket-object-ops.mjs:50-59`
      to reject `..` segments, control characters (0x00-0x1F, 0x7F), and
      backslashes; map each rejection to a distinct error code.
- [ ] 2.2 [fix] Add a prefix-assertion guard at the bottom of
      `buildCanonicalObjectPath` in `storage-logical-organization.mjs:158` that
      verifies the resolved path is rooted under
      `tenants/{tenantId}/workspaces/{workspaceId}/`; throw
      `OBJECT_KEY_ESCAPES_WORKSPACE` otherwise.
- [ ] 2.3 [fix] Register `INVALID_OBJECT_KEY_TRAVERSAL`,
      `INVALID_OBJECT_KEY_CONTROL_CHAR`, `INVALID_OBJECT_KEY_BACKSLASH`,
      `OBJECT_KEY_ESCAPES_WORKSPACE` in
      `services/adapters/src/storage-error-taxonomy.mjs` and map them to
      appropriate HTTP statuses.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      describing the strengthened key validation contract.
- [ ] 3.2 [docs] Update the adapter README to document the rejected
      metacharacters and the rationale.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- storage-bucket-object-ops`
      and `openspec validate fix-g1-path-traversal-and-key-validation --strict`;
      both green before merge.
