## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `tests/integration/scheduling-management-action.test.mjs` that invokes
      the action with no `params.jwt` and `params.tenantId: 'attacker'`, and
      asserts the response is `401 UNAUTHENTICATED` rather than reading or
      writing rows under `attacker`, proving B2 at
      `scheduling-management.mjs:15-22`.
- [ ] 1.2 [test] Add a case that invokes with a JWT lacking `sub` and no
      `actorId`, and asserts `401 UNAUTHENTICATED` rather than writing
      `'system'` into the audit row, proving B9 at `:19`.
- [ ] 1.3 [test] Add a case for each write endpoint that submits a JWT
      missing `scheduling:write` and asserts `403 FORBIDDEN`.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the identity parser at `scheduling-management.mjs:15-22`
      so `tenantId`, `workspaceId`, and `actorId` are read only from a verified
      `params.jwt`. Drop the `?? params.tenantId`, `?? params.workspaceId`, and
      `?? 'system'` fallbacks.
- [ ] 2.2 [fix] Add an `assertAuthenticated(identity)` helper that throws
      `{statusCode: 401, code: 'UNAUTHENTICATED'}` when any required identity
      field is missing; call it at the top of every handler.
- [ ] 2.3 [impl] Add a `requireScope(identity, scope)` helper and invoke it on
      every route: `scheduling:read` for GET endpoints, `scheduling:write` for
      POST/PATCH/DELETE/pause/resume. Surface `403 FORBIDDEN` on mismatch.
- [ ] 2.4 [fix] Apply the same identity rules in
      `scheduling-trigger.mjs` and `scheduling-job-runner.mjs` so background
      handlers can't be invoked with caller-supplied identity.

## 3. Validation

- [ ] 3.1 [docs] Document the JWT-required contract and the two scopes in
      `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:integration` and
      `corepack pnpm test:contract`; both green before merge.
