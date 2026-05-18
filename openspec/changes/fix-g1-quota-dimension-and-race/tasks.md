## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/adapters/storage-capacity-quotas.test.mjs`
      that triggers each of the four violation dimensions and asserts the
      returned `dimensionId` matches the violation dimension (proves B4 at
      `services/adapters/src/storage-capacity-quotas.mjs:555`).
- [ ] 1.2 [test] Add a case that interleaves two `claimStorageQuotaCapacity`
      invocations under a mocked transactional context and asserts the second
      observes the first's claim (proves B8 at `:507-549`).
- [ ] 1.3 [test] Add a case in `tests/adapters/storage-multipart-presigned.test.mjs`
      that registers two parts via the new accumulator update and asserts
      `session.accumulatedSizeBytes` equals the sum of part sizes (proves B12
      at `services/adapters/src/storage-multipart-presigned.mjs:279`).

## 2. Implementation

- [ ] 2.1 [fix] Replace the ternary at `storage-capacity-quotas.mjs:555` with
      a switch over `STORAGE_QUOTA_DIMENSIONS` returning a distinct
      `dimensionId` for each.
- [ ] 2.2 [fix] Introduce `claimStorageQuotaCapacity(ctx, claim)` in
      `storage-capacity-quotas.mjs` that wraps the check at `:507-549` in a
      `context.withQuotaLock(tenantId, async () => { … })` callback; the
      compiler defines the contract, the executor implements the lock.
- [ ] 2.3 [fix] Update the multipart-session helpers in
      `storage-multipart-presigned.mjs:258-284` to expose
      `recordMultipartPartSize(session, partNumber, sizeBytes)` that
      mutates `accumulatedSizeBytes`; document at `:279` that completion
      compares this running total against the part list.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      covering dimension correctness, transactional claim, and accumulator
      integrity.
- [ ] 3.2 [docs] Update the adapter README to document the executor's
      transactional contract (`withQuotaLock`).
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'storage-(capacity-quotas|multipart-presigned)'`
      and `openspec validate fix-g1-quota-dimension-and-race --strict`;
      both green before merge.
