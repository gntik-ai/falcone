# Tasks

- [x] Validate social provider writes and preserve server authorization.
- [x] Merge Keycloak config and protect masked secrets and upstream diagnostics.
- [x] Expose non-secret presence/client metadata and optional callback URL.
- [x] Add session API client, Spanish create/edit forms, toggle and copy controls.
- [x] Gate management actions and retain destructive delete confirmation.
- [x] Add adapter, handler, service, page and permission regression coverage.
- [x] Model Keycloak 26.1.0 masked GET and PUT secret substitution; cover edit/toggle preservation.
- [x] Map adapter race rejections to VALIDATION_ERROR and add console conflict recovery copy.
- [x] Document empty displayName/defaultScope clearing and restore the page header comment.
- [x] Run self-contained adapter tests (5/5 via `node tests/unit/tenant-social-provider.test.mjs`),
  JavaScript syntax checks for the three backend modules and two test files, and `git diff --check`.
- [ ] Run handler tests in PR CI (sandbox lacks kafkajs and other installed dependencies).
- [ ] Run `tests/unit/iam-keycloak-error-sanitization.test.mjs` in PR CI (also blocked at import
  by missing kafkajs in this sandbox).
- [ ] Run console Vitest tests and typecheck in PR CI (sandbox has no node_modules).
- [ ] RUNTIME_REQUIRED: create dummy provider, verify no secret readback, edit without secret,
  verify stored credential and login, replace secret, toggle and delete in staging. Confirm
  Keycloak 26.1.0 masked GET and PUT substitution behavior before releasing. The adapter now
  preserves the server mask on PUT; the fake confirms it is substituted, never stored literally.
- [ ] Product: confirm whether the allowed callback path-pattern fallback is sufficient at release;
  control-plane KEYCLOAK_ISSUER wiring is absent from the deployment values.
