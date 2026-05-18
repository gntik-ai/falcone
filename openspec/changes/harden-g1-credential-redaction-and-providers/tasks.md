## 1. Failing tests

- [ ] 1.1 [test] Add cases to
      `tests/adapters/storage-provider-verification.test.mjs` asserting two
      verification runs with the same `providerType` produce distinct
      tenant ids (proves B5 at
      `services/adapters/src/storage-provider-verification.mjs:241-260`);
      add cases to `tests/adapters/storage-error-taxonomy.test.mjs`
      asserting the redaction sanitiser masks `accesskey:sk_1234`, a
      base64 secret of length > 32, and a JSON `{"secretKey":"abc"}`
      (proves B9 at `storage-error-taxonomy.mjs:196-199`).
- [ ] 1.2 [test] Add a case asserting `buildInternalDiagnostics` masks
      `providerHttpStatus` outside the allowlist (proves B10 at
      `storage-error-taxonomy.mjs:202-215`); add a case asserting
      `provider-catalog` throws `SELECTION_KEYS_COLLISION` when two
      definitions declare the same selectionKey (proves B11).
- [ ] 1.3 [test] Add cases for credential rotation (proves B13 at
      `storage-programmatic-credentials.mjs:86-114, :273`), import/export
      catch chaining (proves B14 at `storage-import-export.mjs:108, :265`),
      error-code normalisation stability (proves B16 at
      `storage-error-taxonomy.mjs:167-173`), and capability-details schema
      drift (proves B17 at `storage-tenant-context.mjs:207-227`).

## 2. Implementation

- [ ] 2.1 [fix] In `storage-provider-verification.mjs:241-260`, derive
      verification fixture ids from `${providerType}_${context.runId ??
      crypto.randomUUID()}`.
- [ ] 2.2 [fix] Replace the redaction regex at
      `storage-error-taxonomy.mjs:196-199` (and the mirror at
      `storage-provider-verification.mjs:156-159`) with a token sanitiser
      that handles word-boundary-free patterns, high-entropy strings, and
      JSON-embedded sensitive keys.
- [ ] 2.3 [fix] Mask `providerHttpStatus` at
      `storage-error-taxonomy.mjs:202-215` to the allowlisted set; coerce
      others to bucket `'unspecified'`.
- [ ] 2.4 [fix] Add startup validation in `provider-catalog.mjs` that asserts
      selectionKeys are unique across all `STORAGE_PROVIDER_DEFINITIONS`;
      throw `SELECTION_KEYS_COLLISION` on overlap.
- [ ] 2.5 [fix] Re-validate scope in
      `storage-programmatic-credentials.mjs:86-114, :273` so rotation
      refuses when `workspaceId` is null on either side; preserve the
      catch-context with `cause` in
      `storage-import-export.mjs:108, :265`; pass-through unknown codes in
      `storage-error-taxonomy.mjs:167-173`; reject mismatched
      `capabilityDetailsSchemaVersion` in
      `storage-tenant-context.mjs:207-227`.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`.
- [ ] 3.2 [docs] Document the new redaction sanitiser, HTTP-status masking,
      selectionKeys uniqueness, rotation scope check, and schema-version
      guard in the adapter README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'storage-'` and
      `openspec validate harden-g1-credential-redaction-and-providers
      --strict`; both green before merge.
