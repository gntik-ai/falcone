## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-admin-roles-trust.test.mjs`
      that calls `validatePostgresAdminSqlRequest` with
      `effectiveRoles: ['workspace_owner']` but no matching signed
      claim; assert the adapter rejects with an unverified-roles
      error (proves B-S2.1 at
      `services/adapters/src/postgresql-admin.mjs:862-864`).
- [ ] 1.2 [test] Add a test that calls a quota-guardrail-bearing
      action with `planId: 'pln_unknown'`; assert the adapter rejects
      with HTTP 400 `PLAN_UNKNOWN` rather than falling back to
      `pln_01growth` defaults (proves B-S2.2 at `:407-416`).
- [ ] 1.3 [test] Add a test that submits a request with
      `placementMode: 'unknown'`; assert the adapter rejects with
      HTTP 400 `PLACEMENT_MODE_UNKNOWN` (proves B-S2.3 at
      `:1440-1442`).
- [ ] 1.4 [test] Add a test that calls the workspace role prefix
      check with `workspaceNamePrefix: ''`; assert the adapter rejects
      with an empty-prefix error (proves B-S2.5 at `:1475-1477`).

## 2. Implementation

- [ ] 2.1 [fix] In
      `services/adapters/src/postgresql-admin.mjs:862-864`, require that
      every entry in `effectiveRoles` corresponds to an entry in a
      signed claim (e.g. JWT `roles` scope) passed alongside the
      request; reject otherwise.
- [ ] 2.2 [fix] At `:407-416`, remove the `pln_01growth` /
      `pln_01regulated` fallback for unknown `planId`; reject with
      HTTP 400 `PLAN_UNKNOWN`.
- [ ] 2.3 [fix] At `:1440-1442`, change placement-mode `'unknown'` from
      a warning to a violation; reject with HTTP 400
      `PLACEMENT_MODE_UNKNOWN`.
- [ ] 2.4 [fix] At `:1475-1477`, treat an empty or missing
      `workspaceNamePrefix` as a configuration error and reject; an
      empty prefix MUST NOT match any role.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the signed-claim verification, the strict
      plan/placement-mode contracts, and the non-empty prefix
      requirement in `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate harden-d1-effective-roles-trust --strict`;
      both green before merge.
