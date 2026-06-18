# Tasks — add-project-auth-config-api

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/.

## Implement (kind runtime AND shippable product)
- [ ] Add owner APIs to toggle auth methods + configure social providers per project, and apply the template's required scopes at realm provisioning — kind `kc-admin.mjs`/`b-handlers.mjs` + product provisioner.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An owner enables username/password + a social provider via the API and the realm's login options reflect it.

## Archive
- [ ] `openspec validate add-project-auth-config-api --strict`; `/opsx:archive add-project-auth-config-api` after merge.
