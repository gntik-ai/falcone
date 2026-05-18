## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/sdk-generate.test.mjs`
      that calls `POST /v1/workspaces/{id}/sdks` end-to-end and asserts the
      response status code is `200`, body's `status` is `'ready'`, and
      `downloadUrl` is non-null, proving B7 at `sdk-generate.mjs:88-104`.
- [ ] 1.2 [test] Add a case that seeds a `ready` package with
      `urlExpiresAt` 1s in the past and asserts a subsequent POST returns
      a fresh `urlExpiresAt` (re-presigned), proving B8 at
      `sdk-generate.mjs:74-87`.

## 2. Implementation

- [ ] 2.1 [fix] Change the success response at
      `sdk-generate.mjs:108-113` from `statusCode: 202, status: 'pending'`
      to `statusCode: 200, status: 'ready'` with `downloadUrl` and
      `urlExpiresAt` populated from the upload result.
- [ ] 2.2 [fix] In the early-return branch at `sdk-generate.mjs:74-87`,
      compute `expiresInMs = pkg.urlExpiresAt - Date.now()`; if it is
      below 10% of the configured TTL or negative, re-presign via
      `sdk-storage.presignExistingArtefact(pkg.archiveKey)`.
- [ ] 2.3 [impl] Add `headSdkArtefact(client, key)` in
      `src/sdk-storage.mjs` returning `{exists, size}`; on `exists =
      false` for an early-return path, reset the row to `'building'` and
      fall through to rebuild.
- [ ] 2.4 [impl] On a rebuilt-and-re-presigned response, set status code
      `205` with body `{status: 'ready', downloadUrl, urlExpiresAt,
      rebuilt: true}` so callers can detect the refresh.

## 3. Validation

- [ ] 3.1 [docs] Update
      `services/openapi-sdk-service/README.md` to describe the synchronous
      contract, the `205 SDK_REBUILT` response, and the re-presign
      threshold.
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
