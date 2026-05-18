## 1. Failing tests

- [ ] 1.1 [test] Add `services/secret-metadata-api/test/routes.test.mjs` that
      starts the service and asserts `GET /v1/secrets/platform/postgresql/app-password`
      returns the metadata object the Vault metadata API exposes for that path
      (no `value`, no `data`).
- [ ] 1.2 [test] Add a case that asserts `GET /v1/secrets/inventory?domain=platform`
      returns a `{secrets: [...]}` payload sourced from `vault list metadata/platform/`.
- [ ] 1.3 [test] Rewrite `tests/hardening/suites/tenant-isolation.test.mjs:38,52`
      to call the new `/v1/secrets/workspaces/{workspaceId}/metadata` route and
      assert 200 for the owning tenant, 403 for a cross-tenant call.
- [ ] 1.4 [test] Add a gateway-contract test that loads
      `services/gateway-config/routes/secrets.yaml` and asserts a request without
      the `secret:metadata:read` scope is rejected at the gateway with 403.

## 2. Implementation

- [ ] 2.1 [impl] Create `services/secret-metadata-api/` (Node service) with
      handlers for the three routes; each handler resolves tenant/workspace
      context from gateway-injected headers (`x-falcone-tenant-id`,
      `x-falcone-workspace-id`) and rejects requests missing them.
- [ ] 2.2 [impl] Add the Vault metadata-only client at
      `services/secret-metadata-api/src/vault-metadata-client.mjs` reading
      `metadata/{domain}/{path}` and `metadata/{domain}/` LIST; the client
      MUST refuse to call `secret/data/*` even if asked.
- [ ] 2.3 [spec] Add `apps/control-plane/openapi/families/secrets.openapi.json`
      with the three operations and an `x-tenant-binding: required` extension
      on the workspace-scoped operation; merge into `control-plane.openapi.json`.
- [ ] 2.4 [migration] Add `services/gateway-config/routes/secrets.yaml` with the
      three routes wired to `keycloak-openid` requiring scope
      `secret:metadata:read`; add the scope to `services/keycloak-config/scopes/platform-realm.yaml`.
- [ ] 2.5 [impl] Wire `services/secret-audit-handler/` to receive a
      `secret.metadata.read` event from every successful read so M2's audit
      pipeline observes the new surface.

## 3. Validation

- [ ] 3.1 [docs] Update `services/internal-contracts/secrets/README.md` to
      describe the runtime (`services/secret-metadata-api/`), the gateway-route
      file, the unified-spec fragment, and the Vault policy binding.
- [ ] 3.2 [test] Run `corepack pnpm test:unit`, the hardening suite, and
      `openspec validate complete-m3-endpoint-implementation --strict`; all
      green before merge.
