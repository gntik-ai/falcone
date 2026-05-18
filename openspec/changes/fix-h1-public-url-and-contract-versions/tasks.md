## 1. Failing tests

- [ ] 1.1 [test] Add a case to `tests/adapters/openwhisk-admin.test.mjs`
      asserting that building an HTTP exposure with no `payload.publicUrl`
      and no `context.publicUrlBase` throws `PUBLIC_URL_BASE_MISSING`
      (proves B2 at `services/adapters/src/openwhisk-admin.mjs:1008, :1012`).
- [ ] 1.2 [test] Add a case to
      `tests/unit/functions-admin-contract-versions.test.mjs` asserting
      `getOpenWhiskCompatibilitySummary`, `buildImportErrorResponse`, and
      `buildAuditCoverageReport` all return the same canonical contract
      version sourced from the central module (proves B5 at
      `apps/control-plane/src/functions-admin.mjs:179`,
      `functions-import-export.mjs:189`, `functions-audit.mjs:145`).
- [ ] 1.3 [test] Add a case asserting
      `buildConsoleBackendWorkflowInvocation` reads the `X-API-Version`
      header from the central module rather than the hard-coded
      `'2026-03-25'` at `console-backend-functions.mjs:96`.

## 2. Implementation

- [ ] 2.1 [impl] Add `apps/control-plane/src/runtime/contract-versions.mjs`
      exposing `getFunctionAdminContractVersion()` that reads the canonical
      version from the internal-contracts package; throw
      `CONTRACT_VERSION_UNAVAILABLE` if absent.
- [ ] 2.2 [fix] Update the four call sites
      (`functions-admin.mjs:179`, `functions-import-export.mjs:189`,
      `functions-audit.mjs:145`, `console-backend-functions.mjs:96`) to read
      from the central module; remove the literal date strings.
- [ ] 2.3 [fix] Replace frozen timestamps in
      `functions-import-export.mjs:189` and `functions-audit.mjs:145` with
      `(context.now ?? (() => new Date().toISOString()))()` so tests can
      inject a clock.
- [ ] 2.4 [fix] In `openwhisk-admin.mjs:1008, :1012`, require
      `context.publicUrlBase` and `context.consoleOrigin`; throw stable
      errors when missing.
- [ ] 2.5 [fix] Replace the hard-coded `requestId: 'req_import_validation'`
      at `functions-import-export.mjs:189` with
      `context.correlationId ?? crypto.randomUUID()`.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`.
- [ ] 3.2 [docs] Document the new `publicUrlBase` / `consoleOrigin` config
      keys and the central contract-version module in the operator runbook.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'functions-'` and
      `openspec validate fix-h1-public-url-and-contract-versions --strict`;
      both green before merge.
