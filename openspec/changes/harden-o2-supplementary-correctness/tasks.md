## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/internal-contracts/test/idempotency-key.test.mjs` calling
      `resolveInitialTenantBootstrap({tenantId:'t1', workspaceId:'w1',
      planId:'p1', ...})` and `..., planId:'p2', ...` for the same workspace;
      assert the two `retry.idempotencyKey` values differ.
- [ ] 1.2 [test] Add a case asserting the workspace subdomain returned by
      `getWorkspaceApplicationBaseUrl` for two tenants with slug `'main'` in
      the same environment differs.
- [ ] 1.3 [test] Add a `countBy` case with three resources whose `kind` is
      `''`, `0`, and `'database'`; assert all three appear in the counts
      (under their own buckets) — none silently dropped.
- [ ] 1.4 [test] Add a case to `evaluateTenantLifecycleMutation` supplying a
      `confirmationText` that does NOT match the draft text; assert the
      purge is rejected with `reasonCode: 'CONFIRMATION_MISMATCH'`.

## 2. Implementation

- [ ] 2.1 [fix] At `index.mjs:1728` replace the idempotency key with
      `signup-activation-${tenantId}-${workspaceId}-${planId}-${provisioningRunId}`;
      reject when any component is null.
- [ ] 2.2 [fix] At `index.mjs:1177` add a tenant qualifier to the subdomain
      template; throw a configuration error when `tenantSlug` is unavailable.
- [ ] 2.3 [fix] At `index.mjs:1308-1313` change the guard to
      `if (key === undefined || key === null) return counts;` so `''`/`0`/`false`
      are counted in their own buckets.
- [ ] 2.4 [fix] In `evaluateTenantLifecycleMutation.purge` compare
      `caller.confirmationText` against `buildTenantPurgeDraft({...}).confirmationText`;
      reject with `CONFIRMATION_MISMATCH` on inequality.
- [ ] 2.5 [fix] Remove the dead ternary at `index.mjs:1738-1739` and the
      unused `workspaceOpenApiVersion` export at `index.mjs:37`.

## 3. Validation

- [ ] 3.1 [docs] Document the tenant-qualified subdomain and the
      idempotency-key composition in `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry self-test suite plus `openspec validate
      harden-o2-supplementary-correctness --strict`; both green.
