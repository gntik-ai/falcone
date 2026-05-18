## 1. Failing tests

- [ ] 1.1 [test] Add `services/internal-contracts/test/lifecycle-purge.test.mjs`
      asserting `evaluateTenantLifecycleMutation({action:'purge', tenant:{...,
      governance:{retentionPolicy:{}}}, ...})` with no `purgeEligibleAt` is
      blocked with `reasonCode: 'RETENTION_POLICY_MISSING'`.
- [ ] 1.2 [test] Add a case that calls `evaluateTenantLifecycleMutation` with
      `hasElevatedAccess:true, hasSecondConfirmation:true` and no
      `authorisationProof`; assert the call is rejected.
- [ ] 1.3 [test] Add a case that supplies an `authorisationProof` whose
      signature does not validate; assert the call is rejected and an audit
      entry is captured naming the failed verification step.

## 2. Implementation

- [ ] 2.1 [fix] Tighten the retention gate at `index.mjs:1524-1527` so a
      missing `purgeEligibleAt` yields `retentionReady = false` and emits
      `RETENTION_POLICY_MISSING` in the rule result.
- [ ] 2.2 [fix] Add an `authorisationProof` parameter to the function
      signature at `index.mjs:1474`; remove the bare `hasElevatedAccess` /
      `hasSecondConfirmation` booleans from the trusted path.
- [ ] 2.3 [fix] Add a verification helper that checks the proof signature,
      audience (`'tenant-lifecycle'`), and expiry; reject all purges whose
      proof fails any check.
- [ ] 2.4 [impl] Emit a `tenant.lifecycle.evaluated` audit record on every
      call carrying the actor, proof id, retention computation, and result.

## 3. Validation

- [ ] 3.1 [docs] Document the new authorisation contract and audit envelope
      in `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry unit suite plus `openspec validate
      fix-o2-tenant-lifecycle-fail-open --strict`; both green.
