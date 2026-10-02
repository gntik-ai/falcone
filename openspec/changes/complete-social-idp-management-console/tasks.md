# Tasks

- [x] Validate social provider writes and preserve server authorization.
- [x] Merge Keycloak config and protect masked secrets and upstream diagnostics.
- [x] Expose non-secret presence/client metadata and optional callback URL.
- [x] Add session API client, Spanish create/edit forms, toggle and copy controls.
- [x] Gate management actions and retain destructive delete confirmation.
- [x] Add adapter, handler, service, page and permission regression coverage.
- [x] Run self-contained adapter tests and JavaScript syntax checks.
- [ ] Run handler tests in PR CI (sandbox lacks kafkajs and other installed dependencies).
- [ ] Run console Vitest tests and typecheck in PR CI (sandbox has no node_modules).
- [ ] RUNTIME_REQUIRED: create dummy provider, verify no secret readback, edit without secret,
  verify stored credential and login, replace secret, toggle and delete in staging. Confirm
  direct admin GET masking behavior against deployed Keycloak before releasing; masked reads
  without a replacement are intentionally rejected with no write.
