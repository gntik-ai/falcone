## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/adapters/openwhisk-admin.test.mjs`
      asserting that a workspace-secret mutation with `context.workspaceId
      = undefined` and `payload.workspaceId = 'wrk_other'` is rejected with
      `SCOPE_VIOLATION` (proves B1 at
      `services/adapters/src/openwhisk-admin.mjs:826`); add the mirror case
      for tenantId at `:830`.
- [ ] 1.2 [test] Add a case asserting that a normalised resource carrying
      two secret references — one for the caller's workspace and one for a
      different workspace — is rejected with `SECRET_REFERENCE_SCOPE_VIOLATION`
      (proves B10 at `openwhisk-admin.mjs:1171-1179`).

## 2. Implementation

- [ ] 2.1 [fix] Invert the guards at `openwhisk-admin.mjs:826` and `:830` so
      `(payloadWorkspaceId && payloadWorkspaceId !== (context.workspaceId ??
      null))` and the tenant mirror always evaluate; a missing caller scope
      MUST produce a violation.
- [ ] 2.2 [fix] Hoist `assertWorkspaceScopedContext(context)` at the top of
      the workspace-secret validator (preceding `:813`) so the absence of
      `context.workspaceId` short-circuits with a stable error before any
      downstream logic runs.
- [ ] 2.3 [fix] At `:1171-1179`, iterate the normalised
      `secretReferences[]` and push a `SECRET_REFERENCE_SCOPE_VIOLATION`
      for each ref whose `workspaceId` does not match the caller's
      workspace.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`
      describing the fail-closed contract.
- [ ] 3.2 [docs] Document the new invariant in the adapter README and the
      `functions-admin` façade README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- openwhisk-admin` and
      `openspec validate fix-h1-secret-scope-fail-open --strict`; both
      green before merge.
