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

## CI Verification

- [ ] Run the wizard Vitest test (sandbox pnpm subprocess returns EPERM).
- [ ] Run existing b-handlers/audit regressions with installed kafkajs and remaining dependencies.
- [ ] Run suite 15 in the disposable real stack, including auth-code PKCE S256, rejected plain
      PKCE and direct grants, foreign-tenant denial and once-only confidential secrets.
- [ ] Build the control-plane image and run the normal image/release gates.
