# Tasks — add-project-auth-config-api

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/...` route exposes it (bbx-568-00..07 in tests/blackbox/project-auth-config-api.test.mjs; the probe first failed because the auth-config handlers/routes and TENANT_REALM_SCOPES did not exist).

## Implement (kind runtime AND shippable product)
- [x] Add owner APIs to toggle auth methods + configure social providers per project, and apply the template's required scopes at realm provisioning — kind `kc-admin.mjs`/`b-handlers.mjs` + product provisioner.
  - kind: kc-admin.mjs gains getRealmAuthConfig/setRealmAuthConfig + listIdentityProviders/upsertIdentityProvider/deleteIdentityProvider + ensureClientScope/setDefaultClientScope/applyRequiredClientScopes; createRealm now applies TENANT_REALM_SCOPES (no template drift).
  - kind: b-handlers.mjs gains getAuthConfig/setAuthConfig/setSocialProvider/deleteSocialProvider (own-tenant guarded via canManageTenant; cross-tenant → 403); routes.mjs registers GET/PUT /v1/tenants/{tenantId}/auth-config and PUT/DELETE .../auth-config/identity-providers/{alias}.
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.
  - product: services/adapters/src/keycloak-admin.mjs realm normalizer now surfaces requiredScopes (from the template's requiredClientScopes), parity with the kind runtime's TENANT_REALM_SCOPES.

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes. (tests/blackbox/run.sh: 816/816; adapters 143/143; contracts 232 pass/17 skip/0 fail.)
- [x] Acceptance: An owner enables username/password + a social provider via the API and the realm's login options reflect it. (bbx-568-02 toggles registration; bbx-568-03 upserts a social IdP and reads it back; bbx-568-07 proves required scopes are applied.)

## Archive
- [x] `openspec validate add-project-auth-config-api --strict`; `/opsx:archive add-project-auth-config-api` after merge.
