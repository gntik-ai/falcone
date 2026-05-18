## 1. Failing tests

- [ ] 1.1 [test] Add `services/audit/test/self-audit.contract.test.mjs`
      cases: (a) `isSuperadminActor({realm_access:{roles:['superadmin']}})`
      returns `true`; (b) `isSuperadminActor({scopes:['superadmin']})`
      returns `false` (the legacy dead-check pattern), proving B9 from
      `observability-audit-pipeline.json:258-269`.
- [ ] 1.2 [test] Add a case asserting `emitAuditEvent` rejects a
      self-audit envelope (one with a pipeline-configuration action
      category) when `authzContext` lacks the `superadmin` realm role.

## 2. Implementation

- [ ] 2.1 [impl] Add `isSuperadminActor(authzContext)` to
      `services/audit/src/authorization-context.mjs`; inspect
      `authzContext.realm_access?.roles` for `'superadmin'`. Do NOT
      consult any `scope` literal list.
- [ ] 2.2 [fix] Add a `requireSuperadminForSelfAudit(envelope,
      authzContext)` guard inside `emit.mjs` invoked only when the
      envelope's `action.category` indicates a pipeline-configuration
      change (per `observability-audit-pipeline.json:258-269`).
- [ ] 2.3 [docs] Document the realm-role vs scope-literal distinction
      in `services/audit/src/README.md` so future audits and authors
      do not regress.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @in-falcone/audit test` and
      `openspec validate fix-m1-self-audit-superadmin-check --strict`;
      both green.
