## 1. Failing tests

- [ ] 1.1 [test] Add a Lua spec under
      `services/gateway-config/tests/plugins/` that sends a request to
      `/v1/admin/tenants/tenant-A/config/format-versions` with a JWT carrying
      `tenant_id: tenant-B` and asserts the plugin returns
      `403 TENANT_BINDING_MISMATCH`; today the request reaches the upstream
      because no APISIX-level binding check exists (proves G-S5.6 part 1).
- [ ] 1.2 [test] Add a CI check under
      `services/gateway-config/tests/tenant-binding-coverage.test.mjs` that
      asserts every route whose path matches `**/tenants/*/**` declares a
      `tenant_binding:` field; today the test fails on every wildcard route
      in `backup-admin-routes.yaml` and `platform-admin-routes.yaml` (proves
      G-S5.6 part 2).
- [ ] 1.3 [test] Add a spec asserting a platform admin can call
      `/v1/admin/tenants/tenant-A/config/...` with a JWT carrying `tenant_id:
      tenant-platform`; the bypass MUST allow the call (regression guard).

## 2. Implementation

- [ ] 2.1 [impl] Add a `tenant_binding` config to `scope-enforcement.lua`
      that, when set, extracts the named path segment and asserts it matches
      `claims.tenant_id`; on mismatch return `403 TENANT_BINDING_MISMATCH`
      with an audit event; the platform-admin bypass MUST short-circuit
      before this check (resolves G-S5.6 enforcement).
- [ ] 2.2 [impl] Annotate every tenant wildcard route in
      `services/gateway-config/routes/backup-admin-routes.yaml` and
      `routes/platform-admin-routes.yaml` with
      `tenant_binding: { segment_index: <N>, claim: tenant_id }` so the
      plugin knows which segment carries the tenant id (resolves G-S5.6
      coverage).
- [ ] 2.3 [impl] Wire the CI check from 1.2 into the package's lint step so
      a new tenant wildcard route without `tenant_binding` blocks merge.

## 3. Validation

- [ ] 3.1 [docs] Document the `tenant_binding` config and the new CI check
      in `services/gateway-config/README.md`.
- [ ] 3.2 [test] Run the three new tests; run
      `openspec validate harden-n1-tenant-binding-enforcement --strict`; all
      green before merge.
