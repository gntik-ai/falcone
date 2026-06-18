# Tasks — add-project-auth-method-config-api

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/.

## Implement (kind runtime AND shippable product as applicable)
- [ ] A project-scoped API to toggle auth methods + configure social providers (credentials redacted).

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An owner enables/disables a method via the API and the app's login options reflect it.

## Archive
- [ ] `openspec validate add-project-auth-method-config-api --strict`; `/opsx:archive add-project-auth-method-config-api` after merge.
