## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/adapters/storage-multipart-presigned.test.mjs`
      that builds a record via `buildPresignedUrlRecord` and asserts the
      returned `signature` is non-empty and verifies via
      `verifyPresignedUrlRecord` with the same key (proves B3 at
      `services/adapters/src/storage-multipart-presigned.mjs:567`).
- [ ] 1.2 [test] Add a case asserting `verifyPresignedUrlRecord` returns
      `{valid: false, reasonCode: 'PRESIGNED_SIGNATURE_INVALID'}` when the
      key differs and `{valid: false, reasonCode: 'PRESIGNED_EXPIRED'}` when
      `now > expiresAt`.
- [ ] 1.3 [test] Add a case asserting `buildPresignedUrlRecord` rejects a
      `grantedTtlSeconds` greater than `MAX_PRESIGNED_TTL_SECONDS` with
      `errorCode: 'PRESIGNED_TTL_EXCEEDED'`.

## 2. Implementation

- [ ] 2.1 [fix] Replace the `buildOpaqueReference` call at
      `storage-multipart-presigned.mjs:567` with an HMAC-SHA256 over the
      canonical tuple; require `context.presignedUrlSigningKey` and
      `context.signingKeyId` and throw `PRESIGNED_SIGNING_KEY_MISSING` if
      absent.
- [ ] 2.2 [fix] Extend the returned record at `:547-579` with `signature`,
      `signatureAlgorithm: 'HMAC-SHA256'`, and `signingKeyId`; keep
      `presignedUrlRef` as a non-authoritative correlation id.
- [ ] 2.3 [impl] Add `verifyPresignedUrlRecord(record, { signingKey, now })`
      in the same module that recomputes the HMAC, validates `now <
      expiresAt`, and returns `{valid, reasonCode}` without throwing.
- [ ] 2.4 [fix] Enforce a configurable `MAX_PRESIGNED_TTL_SECONDS`
      (default 604800 = 7 days) in the TTL clamp at the top of
      `buildPresignedUrlRecord`.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      describing HMAC signing, expiry enforcement, and TTL bounds.
- [ ] 3.2 [docs] Document the new executor contract (every consumer MUST call
      `verifyPresignedUrlRecord`) in the adapter README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- storage-multipart-presigned`
      and `openspec validate fix-g1-presigned-url-signature --strict`; both
      green before merge.
