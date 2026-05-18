## 1. Failing tests

- [ ] 1.1 [test] Add `services/internal-contracts/test/hostname-default.test.mjs`
      asserting `getWorkspaceApplicationBaseUrl` for an environment in
      `optional_workspace_subdomain.allowed_environments` MUST NOT contain the
      substring `example.com`.
- [ ] 1.2 [test] Add a case that calls
      `evaluateTenantLifecycleMutation({action:'purge', tenant, ...})` without
      `now`; assert the call throws `MissingClockError` rather than evaluating
      against the literal `'2026-03-24T00:00:00Z'`.
- [ ] 1.3 [test] Add a case that calls `resolveInitialTenantBootstrap({...})`
      without `provisioningRunId`; assert the call throws rather than returning
      a result keyed on `'prn_bootstrappreview'`.

## 2. Implementation

- [ ] 2.1 [fix] Remove the `= '2026-03-24T00:00:00Z'` default from the eight
      signatures at `index.mjs:1111, :1152, :1326, :1368, :1416, :1479, :1622,
      :1733`; throw `MissingClockError` when the parameter is `undefined`.
- [ ] 2.2 [fix] In `getWorkspaceApplicationBaseUrl` at `index.mjs:1177` derive
      the base hostname from
      `environmentProfile.hostnames.workspaceApplicationBase`; throw when the
      profile lacks the field.
- [ ] 2.3 [fix] Remove the `= 'prn_bootstrappreview'` default at
      `index.mjs:1620`; require `provisioningRunId` and throw when missing.
- [ ] 2.4 [migration] Extend `deployment-topology.json` to add
      `hostnames.workspaceApplicationBase` per environment listed in
      `optional_workspace_subdomain.allowed_environments`.
- [ ] 2.5 [fix] Sweep the 50 importers (per audit `G1`/`G16`) and pass real
      `Date.now()`-derived timestamps and real `provisioningRunId` values at
      every call site.

## 3. Validation

- [ ] 3.1 [docs] Document the new "no implicit clock, no literal hostname,
      no shared run id" contract in `services/internal-contracts/README.md`.
- [ ] 3.2 [test] Run the registry unit suite plus `openspec validate
      fix-o2-hostname-and-frozen-clock-defaults --strict`; both green before
      merge.
