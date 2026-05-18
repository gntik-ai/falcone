## 1. Failing tests

- [ ] 1.1 [test] Extend `services/gateway-config/tests/capability-enforcement.test.mjs`
      with a case that registers a route whose path contains a literal `:`
      (e.g. `/v1/secrets/colon:/path`) and asserts the lookup key does not
      collide with `(method, /v1/secrets/colon)`; today the test fails because
      `:` is both the delimiter and a path char (proves B6).
- [ ] 1.2 [test] Add a values-test that loads `helm/values.yaml` and asserts
      `scopeEnforcement.enabled == true`; today the test fails because the
      default is `false` (proves B7, G-S2.1).
- [ ] 1.3 [test] Add a CI test under `services/gateway-config/tests/` that
      scans every `routes/*.yaml` for OIDC plugin references and asserts only
      `keycloak-openid-connect` is used; today the test fails on
      `backup-audit-routes.yaml:6` (proves B8, G-S5.4).

## 2. Implementation

- [ ] 2.1 [fix] Replace the route-key delimiter at
      `services/gateway-config/plugins/capability-enforcement.lua:43` with a
      non-printable character (e.g. `\x1f`) and update the matching lookup
      sites; document the choice in a plugin header comment (resolves B6).
- [ ] 2.2 [fix] Set `scopeEnforcement.enabled: true` at
      `services/gateway-config/helm/values.yaml:1` (resolves B7); leave
      `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED: "false"` untouched until
      `complete-n1-plugin-classifier-stubs` lands.
- [ ] 2.3 [fix] Rename `openid-connect` → `keycloak-openid-connect` at
      `services/gateway-config/routes/backup-audit-routes.yaml:6` (resolves
      B8, G-S5.4).

## 3. Validation

- [ ] 3.1 [docs] Update `services/gateway-config/README.md` to record the new
      enabled-by-default scope-enforcement posture and the OIDC plugin-name
      convention; cross-link `complete-n1-plugin-classifier-stubs` for the
      privilege-domain follow-up.
- [ ] 3.2 [test] Re-run the three tests added in section 1; run
      `openspec validate fix-n1-plugin-defaults-and-naming --strict`; all
      green before merge.
