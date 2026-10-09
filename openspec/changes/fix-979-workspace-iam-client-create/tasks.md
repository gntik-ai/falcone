## Implementation

- [x] Reproduce the missing seed route with a deterministic failing route regression.
- [x] Register and package the route and local handler; remove the catalog GAP note.
- [x] Share the existing workspace authorization and Keycloak error normalization helpers.
- [x] Implement validation, ownership tags, all three client types and verified realization.
- [x] Implement equivalent replay, configuration conflict and concurrent duplicate handling.
- [x] Return secrets only on verified creation with Cache-Control: no-store.
- [x] Compensate failed creation attempts and emit redacted audit evidence including cleanup UUID.
- [x] Run scoped boundary tests and existing OIDC helper regressions.
- [x] Extend wizard payload assertions and add real API/Keycloak PKCE integration coverage.
- [x] Reproduce the loss of realm defaults with scopes: [] before changing the handler.
- [x] Merge requested scopes with realm defaults and verify that merged set on create/replay.
- [x] Install and verify the existing server-owned tenant identity mapper for all client types.
- [x] Cover scope additions, dropped defaults, mapper failures, compensation and redacted logs.
- [x] Remove the scope allowlist's ownership-tag mode flag and share replay/validation logic.
- [x] Use the wizard's default payload in suite 15 and assert subject, tenant, workspace and roles.

## CI Verification

- [ ] Run the wizard Vitest test (pnpm's node subprocess returns EPERM; web-console dependencies
      are also not installed in the sandbox).
- [ ] Run existing b-handlers/audit regressions with installed kafkajs and remaining dependencies.
- [ ] Run suite 15 in the disposable real stack, including auth-code PKCE S256, rejected plain
      PKCE and direct grants, foreign-tenant denial, identity claims with scopes: [], and once-only
      confidential secrets (sandbox has no configured control-plane/Keycloak test stack).
- [ ] Build the control-plane image and run the normal image/release gates (sandbox access to
      /var/run/docker.sock is denied and network access is unavailable).

## Follow-up verification evidence

- Reproduction: node --test --experimental-test-isolation=none --test-name-pattern='unchecked
  wizard scopes' tests/unit/workspace-iam-client-create.test.mjs failed twice before the fix:
  realized defaultClientScopes was [] instead of the realm's identity/context defaults.
- The workspace IAM, external application helper/route regressions pass (60 tests); audit
  builder/authorization-denial regressions pass (8 tests). OpenSpec strict validation passes.
- Existing IAM-user/b-handlers regression cannot load kafkajs in this sandbox. Suite 15 skips
  because the real control-plane/Keycloak stack is not configured. CI verification stays pending.
- The accepted product follow-up remains: manage_iam alone opens the wizard but does not confer
  tenant owner/admin authority. The packaged-image Dockerfile guard is retained as accepted.
