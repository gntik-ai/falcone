## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add a test in
      `services/adapters/tests/postgresql-data-api-rls-session-context.test.mjs`
      that invokes `list` with `sessionContext: {}` (no `tenantId` key)
      and asserts the adapter raises `RlsSessionContextMissingError`;
      today the adapter emits a `tenantId = NULL` predicate at
      `services/adapters/src/postgresql-data-api.mjs:602-604` and the
      query silently returns zero rows (proves B-S3.1).
- [ ] 1.2 [test] Add a test that invokes `list` with a matcher
      `{kind: 'session_equals_row', sessionKey: 'workspaceId', columnName:
      'workspaceId'}` and an empty `sessionContext`; assert the adapter
      raises `RlsSessionContextMissingError` for the named key (proves
      G-S3.2 — the default matcher is not the only matcher and the
      precondition must apply to all of them).

## 2. Implementation

- [ ] 2.1 [fix] In
      `services/adapters/src/postgresql-data-api.mjs:595-611`, add a
      precondition check before `pushValue(values, sessionContext?.[…])`:
      when the resolved session key is absent or `undefined`, raise
      `RlsSessionContextMissingError` carrying the matcher kind and key.
- [ ] 2.2 [fix] Wire the error through the data-API request layer so
      the caller receives HTTP 400 with code
      `RLS_SESSION_CONTEXT_MISSING`; the response MUST NOT be HTTP 200
      with an empty result set.
- [ ] 2.3 [spec] Publish the canonical `sessionContext` shape and the
      matcher precondition contract through
      `services/internal-contracts/`; document that every matcher kind
      catalogued at
      `services/adapters/src/postgresql-governance-admin.mjs:646-654`
      MUST honour the precondition.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the `RlsSessionContextMissingError` contract
      and the canonical `sessionContext` shape in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run targeted tests plus
      `openspec validate fix-d1-rls-session-context --strict`; both
      green before merge.
