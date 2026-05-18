## 1. Failing tests

- [ ] 1.1 [test] Add
      `services/internal-contracts/test/audit-schema-lookup.test.mjs` calling
      `getAuditEventSchemaForSubsystem('definitely-not-a-real-subsystem')`;
      assert the return value is `null`, not the unfiltered top-level schema.
- [ ] 1.2 [test] Add
      `services/internal-contracts/test/capability-shape.test.mjs` calling
      `resolveWorkspaceEffectiveCapabilities` against a fixture capability
      with `allowedEnvironments` omitted; assert the call throws a named
      `RegistryShapeError` that cites the missing field — not a raw TypeError.
- [ ] 1.3 [test] Add a case calling `resolveTenantEffectiveCapabilities`
      against a fixture plan with `capabilityKeys` omitted; assert the same
      named `RegistryShapeError`.

## 2. Implementation

- [ ] 2.1 [fix] In `getAuditEventSchemaForSubsystem` at `index.mjs:525-546`
      return `null` from the fall-through branch; never return the unfiltered
      top-level schema.
- [ ] 2.2 [fix] At `index.mjs:1156` wrap the `.includes(...)` call with a
      shape check that throws `RegistryShapeError` naming the capability id
      and the missing `allowedEnvironments` field.
- [ ] 2.3 [fix] At `index.mjs:1131` apply the same defence to
      `plan.capabilityKeys.includes(...)`; throw `RegistryShapeError` when
      missing.
- [ ] 2.4 [impl] Update M1 audit consumers that branch on the prior shape to
      handle `null` from `getAuditEventSchemaForSubsystem`.

## 3. Validation

- [ ] 3.1 [docs] Document the new `null`-on-miss contract and
      `RegistryShapeError` in `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry unit suite plus `openspec validate
      fix-o2-registry-lookup-safety --strict`; both green.
