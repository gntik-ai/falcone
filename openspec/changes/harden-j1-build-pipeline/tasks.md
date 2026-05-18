## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/openapi-spec-regenerate.test.mjs`
      that fires two concurrent regenerate invocations against the same
      workspace and asserts both return `200` (serialised by the advisory
      lock) rather than one returning `500` from a unique violation,
      proving B15 at `openapi-spec-regenerate.mjs:30-46`.
- [ ] 1.2 [test] Add a case that pre-seeds a `'stale'` package with
      `spec_version: '1.0.0'`, regenerates to spec version `2.0.0`, then
      requests rebuild and asserts the resulting package row stores
      `spec_version: '2.0.0'`, proving B16 at
      `openapi-spec-regenerate.mjs:36`.

## 2. Implementation

- [ ] 2.1 [fix] Wrap `openapi-spec-regenerate.main` in a transaction that
      first calls `SELECT pg_advisory_xact_lock(hashtext('openapi-spec-regen:'
      || $workspaceId))`; the rest of the function runs inside that
      transaction.
- [ ] 2.2 [fix] In the rebuild branch (`sdk-generate.mjs` early-return on
      `'stale'`), set `spec_version` to the current `getCurrentSpec`
      result rather than the row's stored value before calling
      `updateSdkPackageStatus`.
- [ ] 2.3 [fix] In `sdk-builder.mjs:35-41` `archiveDirectory`, switch
      `stdio: 'ignore'` to `['ignore', 'ignore', 'pipe']`; collect stderr
      and include it in any thrown `BuildArchiveError`.
- [ ] 2.4 [fix] Read `SDK_BUILD_TIMEOUT_SECONDS` (default 240, max 1800)
      from `config.mjs`; pass to the spawn in `sdk-builder.mjs:65`;
      surface the configured value in the timeout error message.
- [ ] 2.5 [fix] Remove `allowBareInternalHttp: true` from the
      `effectiveCapabilitiesBaseUrl` normalisation at `config.mjs:53-59`;
      add an explicit `INTERNAL_HOST_ALLOWLIST` (default `['kubernetes',
      '*.svc.cluster.local']`); reject any host outside the list.
- [ ] 2.6 [fix] Pre-walk the generator output dir in `buildSdk` and
      throw `BuildArchiveError('SYMLINK_FOUND')` if any entry is a
      symlink before invoking `archiveDirectory`.
- [ ] 2.7 [fix] In `sdk-storage.uploadSdkArtefact`, wrap the
      `createReadStream` invocation in `try { await put… } finally {
      stream.destroy(); }` so failures release the file descriptor.

## 3. Validation

- [ ] 3.1 [docs] Document the advisory-lock contract, the timeout cap,
      the symlink rejection, and the internal-host allow-list in
      `services/openapi-sdk-service/README.md`.
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
