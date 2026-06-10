## 1. Baseline

- [ ] 1.1 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] 1.2 Confirm `openspec validate add-console-rls-policies --strict` passes

## 2. Black-box tests (write first, against tests/env real Postgres)

- [ ] 2.1 Write black-box test: `POST .../policies` with a valid permissive policy
  and `usingExpression: (tenant_id = current_setting('app.tenant_id'))` returns
  HTTP 201 and the policy is present in the subsequent GET list (`bbx-rls-create-policy`)
- [ ] 2.2 Write black-box test: anon-key data request after the policy is applied
  returns only rows matching the `tenant_id` predicate; rows for other tenants
  are absent from the result (`bbx-rls-anon-row-filter`)
- [ ] 2.3 Write black-box test: `PUT .../tables/{table}/security` with
  `{ rlsEnabled: true }` emits `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  and the security GET returns `rlsEnabled: true` (`bbx-rls-enable-toggle`)
- [ ] 2.4 Write black-box test: `PUT .../tables/{table}/security` with
  `{ rlsEnabled: false }` without `disableGuard` is rejected with HTTP 422
  (`bbx-rls-disable-no-guard`)
- [ ] 2.5 Write black-box test: table with `rlsEnabled: true` and no policies
  returns `{ allowed: false, reason: 'no_applicable_rls_policy' }` from the
  access-evaluation path (`bbx-rls-default-deny`)
- [ ] 2.6 Write black-box test: a `RESTRICTIVE` policy whose predicate is false
  blocks access even when a passing `PERMISSIVE` policy is present
  (`bbx-rls-restrictive-veto`)
- [ ] 2.7 Write black-box test: a service-role policy with `usingExpression: true`
  allows a service-key caller to read all rows while an anon policy restricts anon
  callers to filtered rows (`bbx-rls-service-role-bypass`)
- [ ] 2.8 Write black-box test: Tenant A cannot read or delete a policy on a table
  belonging to Tenant B — expects HTTP 403 or 404 (`bbx-rls-cross-tenant-policy`)
- [ ] 2.9 Confirm all new tests fail before implementation (red-green discipline)

## 3. Control-plane write handlers

- [ ] 3.1 Implement `POST /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies`
  in `apps/control-plane/src/postgres-admin.mjs` — delegate to
  `buildPostgresGovernanceSqlPlan({ resourceKind: 'policy', action: 'create', ... })`
  and pass the resulting statements to the executor
- [ ] 3.2 Implement `PUT /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies/{policyName}`
  — delegate to `buildPostgresGovernanceSqlPlan` with `action: 'update'`
- [ ] 3.3 Implement `DELETE /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies/{policyName}`
  — delegate to `buildPostgresGovernanceSqlPlan` with `action: 'delete'`
- [ ] 3.4 Implement `PUT /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security`
  write path — delegate to `buildPostgresGovernanceSqlPlan` with
  `resourceKind: 'table_security', action: 'update'`; enforce `disableGuard`
  validation from `validatePostgresGovernanceRequest` (lines 379-392)
- [ ] 3.5 Add `autoEnableRls: true` support on `POST .../policies` so the handler
  automatically emits `ENABLE ROW LEVEL SECURITY` before `CREATE POLICY` when the
  table has `rlsEnabled: false` (mirrors the existing plan logic at line 556-558)

## 4. Console policy builder

- [ ] 4.1 Add a `CreatePolicyForm` component inside the `policies` tab panel in
  `apps/web-console/src/pages/ConsolePostgresPage.tsx` with fields:
  `policyName`, `policyMode` (permissive/restrictive select), `command`
  (all/select/insert/update/delete select), `roles` (multi-value text), `usingExpression`,
  `withCheckExpression`
- [ ] 4.2 Implement SQL preview: on form submission call a preview endpoint (or
  compute client-side from the form values) and display the `CREATE POLICY`
  statement before confirming
- [ ] 4.3 Wire `POST .../policies` on confirmation; refresh the policy list on success
- [ ] 4.4 Add inline delete action per policy row in the list; wire
  `DELETE .../policies/{policyName}` with a confirmation dialog
- [ ] 4.5 Add role-preset buttons: `anon` (pre-fills
  `usingExpression: (tenant_id = current_setting('app.tenant_id'))`) and
  `service_role` (pre-fills `usingExpression: true`)

## 5. Console security tab enhancements

- [ ] 5.1 Add an `ENABLE RLS` toggle button in the `security` tab; wire to
  `PUT .../security` with `{ rlsEnabled: true, forceRls: false }` on activate
- [ ] 5.2 Add a `FORCE RLS` toggle with explanatory tooltip; wire to
  `PUT .../security` with `{ forceRls: true/false }`
- [ ] 5.3 Display a default-deny warning banner when `rlsEnabled: true && policyCount === 0`
  with a call-to-action that navigates to the `policies` tab and opens
  `CreatePolicyForm`
- [ ] 5.4 Show the `disableGuard` acknowledgement dialog when admin attempts to
  disable RLS on a `tenant_scoped` table; pass
  `disableGuard.acknowledgeTenantIsolationImpact: true` and `disableGuard.reason`
  to the API call

## 6. Integration validation

- [ ] 6.1 Run `bash tests/blackbox/run.sh` — all new and existing tests pass
- [ ] 6.2 Run `openspec validate add-console-rls-policies --strict`
