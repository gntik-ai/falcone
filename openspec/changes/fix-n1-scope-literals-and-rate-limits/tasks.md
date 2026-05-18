## 1. Failing tests

- [ ] 1.1 [test] Add `services/gateway-config/tests/scope-manifest-coverage.test.mjs`
      that loads every `required_scopes` literal from
      `services/gateway-config/routes/*.yaml` and asserts each appears in at
      least one `services/keycloak-config/scopes/*.yaml`; today the test fails
      on `platform:admin:backup:read` and `tenant:backup:read` (proves B1).
- [ ] 1.2 [test] Extend the same suite to assert no route declares
      `required_scopes: []`; today the test fails on
      `services/gateway-config/routes/backup-operations-routes.yaml:51-54`
      (proves B4).
- [ ] 1.3 [test] Add a YAML-schema test that loads
      `services/gateway-config/routes/plan-management-routes.yaml` and asserts
      every route entry has at least one of `limit-req`/`limit-count`/`rate`;
      today the test fails on all 27 routes (proves B3, G-S5.1).

## 2. Implementation

- [ ] 2.1 [spec] Add `platform:admin:backup:read` and `tenant:backup:read` to
      the canonical Keycloak scope manifest(s) under
      `services/keycloak-config/scopes/` with the same `display_name` /
      `description` shape used by sibling scopes (resolves B1, G-S5.2).
- [ ] 2.2 [fix] Set `required_scopes: ['backup-status:read:own']` on
      `backup-operation-get` at
      `services/gateway-config/routes/backup-operations-routes.yaml:51-54`
      and add `backup-status:read:global` as the cross-tenant alternative
      (resolves B4, G-S5.3).
- [ ] 2.3 [fix] Add `limit-req`/`limit-count` to all 27 routes in
      `services/gateway-config/routes/plan-management-routes.yaml`, calibrated
      to the `control_plane` QoS profile in
      `services/gateway-config/base/public-api-routing.yaml` (resolves B3,
      G-S5.1).

## 3. Validation

- [ ] 3.1 [docs] Document the new scope literals and rate-limit profile in
      `services/gateway-config/README.md`.
- [ ] 3.2 [test] Re-run the scope-manifest, empty-scope, and rate-limit tests;
      run `openspec validate fix-n1-scope-literals-and-rate-limits --strict`;
      all green before merge.
