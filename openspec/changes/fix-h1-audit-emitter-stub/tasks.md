## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/unit/functions-audit.test.mjs`
      asserting that `emitDeploymentAuditEvent`, `emitAdminActionAuditEvent`,
      `emitRollbackEvidenceEvent`, and `emitQuotaEnforcementEvent` all
      throw `FUNCTION_AUDIT_PUBLISHER_MISSING` when
      `context.publishAuditEvent` is unset (proves B6 at
      `apps/control-plane/src/functions-audit.mjs:34-37`).
- [ ] 1.2 [test] Add a case asserting `queryAuditRecords` throws
      `FUNCTION_AUDIT_LOADER_MISSING` when
      `context.queryAuditRecords` is unset (proves B7 at
      `functions-audit.mjs:91`).
- [ ] 1.3 [test] Add a case asserting `withFunctionAuditWiring(context)`
      throws when either wiring slot is missing and returns the context
      otherwise.

## 2. Implementation

- [ ] 2.1 [fix] Remove the silent stub at `functions-audit.mjs:34-37`;
      make the publisher resolution
      `const publisher = context.publishAuditEvent ?? (() => { throw new
      Error('FUNCTION_AUDIT_PUBLISHER_MISSING'); });` and document the
      contract.
- [ ] 2.2 [fix] Remove the silent loader at `functions-audit.mjs:91`;
      make the loader resolution analogous with
      `FUNCTION_AUDIT_LOADER_MISSING`.
- [ ] 2.3 [impl] Add `withFunctionAuditWiring(context)` in
      `functions-audit.mjs` that returns the context unchanged when both
      slots are populated and throws a combined error listing missing
      slots otherwise.
- [ ] 2.4 [fix] Update the gateway-facing factory in
      `apps/control-plane/src/functions-admin.mjs` to inject the production
      publisher and loader; remove DI fallbacks that today rely on the
      stub.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`.
- [ ] 3.2 [docs] Document the new fail-closed contract in the
      `functions-admin` README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- functions-audit` and
      `openspec validate fix-h1-audit-emitter-stub --strict`; both green
      before merge.
