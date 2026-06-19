# Tasks — add-project-auth-method-config-api

## Status: SUPERSEDED by #568 (no code change)
- [x] Verified the project auth-method / social-IdP config API already exists (archived `add-project-auth-config-api`, #568): routes `routes.mjs:58-61`, handlers `b-handlers.mjs:853-921`, KC admin client `kc-admin.mjs` (`getRealmAuthConfig`/`setRealmAuthConfig`/`listIdentityProviders`/`upsertIdentityProvider`), audit mapping `audit-writer.mjs`.
- [x] Confirmed black-box coverage already passes: `tests/blackbox/project-auth-config-api.test.mjs` (8/8).
- [x] Recorded the corrected scope in `proposal.md`; close GitHub issue #599 as superseded by #568.

## Archive
- [ ] Withdraw/cancel this change (it duplicates archived #568); no spec delta to sync.
