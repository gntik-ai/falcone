## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-governance-admin-correctness.test.mjs`
      that calls `safeIdentifier('pg_signal_backend')`; assert the
      function returns `undefined` (or raises). Today both branches at
      `services/adapters/src/postgresql-governance-admin.mjs:64-68` return
      `normalized`, so the call returns the input unchanged (proves B-S5.1
      and B-S5.4).
- [ ] 1.2 [test] Add a test that builds a `policy` resource with
      `roles: ['pg_signal_backend']` and asserts validation rejects with a
      reserved-role error; today
      `postgresql-governance-admin.mjs:121-124` only `.trim()`s and the
      role is silently accepted (proves B-S5.2).
- [ ] 1.3 [test] Add a test that issues a grant update with
      `privileges: []`; assert the emitted SQL plan contains zero
      statements (or rejects validation). Today line 213/219 emit
      `REVOKE ALL PRIVILEGES` (proves B-S5.3).

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `safeIdentifier` at
      `services/adapters/src/postgresql-governance-admin.mjs:64-68` so
      the `IDENTIFIER_PATTERN` and `RESERVED_PREFIX_PATTERN` branches
      actually diverge: return `undefined` (or raise
      `ReservedIdentifierError`) on the reserved branch.
- [ ] 2.2 [fix] Call `safeIdentifier` from every identifier-quoting
      site in the file (policy/table/schema/role names), threading the
      result into `quoteIdent`. Reject inputs where `safeIdentifier`
      returns `undefined`.
- [ ] 2.3 [fix] Add the `pg_*` / `postgres` reserved-role check to
      `normalizePolicyRoles` at
      `postgresql-governance-admin.mjs:121-124`, mirroring the grant-path
      check at `:437-439`.
- [ ] 2.4 [fix] Change the REVOKE path at
      `postgresql-governance-admin.mjs:213, 219` so an empty
      `normalized.privileges` array yields no statements (or a 400
      validation error). The `REVOKE ALL PRIVILEGES` fallback MUST be
      removed.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the symmetric reserved-role policy and the
      empty-privileges contract in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate fix-d1-governance-policy-correctness --strict`;
      both green before merge.
