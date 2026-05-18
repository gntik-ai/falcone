## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/secret-metadata-security.test.mjs`
      that asserts both YAMLs declare a `components.securitySchemes.bearerAuth`
      entry and a top-level `security` block requiring scope
      `secret:metadata:read`.
- [ ] 1.2 [test] Add a case that asserts a sample inventory 200 response
      missing the `pagination` envelope fails schema validation, and one
      with `{secrets, pagination: {total, offset, limit, nextOffset, hasMore}}`
      passes.
- [ ] 1.3 [test] Add a case that asserts `SecretMetadataItem` carries
      `lastAccessedAt`, `vaultMount`, `accessPolicies` and that an inventory
      payload missing them fails validation.
- [ ] 1.4 [test] Add a case that asserts an inventory call without
      `tenantId` and without scope `platform:admin:secrets:list` is rejected
      at the gateway (403) and that the same call with the scope succeeds.

## 2. Implementation

- [ ] 2.1 [fix] Add the security scheme + top-level `security` block to
      `services/internal-contracts/secrets/secret-metadata-v1.yaml` and
      `secret-inventory-v1.yaml`; document the scope as
      `secret:metadata:read`.
- [ ] 2.2 [fix] Expand the inventory 200 envelope to
      `{secrets, pagination: {total, offset, limit, nextOffset, hasMore}}`
      and add fields `lastAccessedAt`, `vaultMount`, `accessPolicies` to
      `SecretMetadataItem` so it matches the detail-response field set.
- [ ] 2.3 [migration] Migrate both YAMLs from `openapi: 3.0.3` to
      `openapi: 3.1.0`; rewrite `nullable: true` to
      `type: [..., 'null']` per JSON-Schema-2020-12.
- [ ] 2.4 [impl] Add the `platform:admin:secrets:list` scope to
      `services/keycloak-config/scopes/platform-realm.yaml`; wire the
      inventory route at `services/gateway-config/routes/secrets.yaml` to
      require it when the `tenantId` query parameter is absent.
- [ ] 2.5 [impl] In `services/secret-metadata-api/src/routes/secret-inventory.mjs`,
      populate the new `pagination` envelope and the additional item
      fields from the Vault LIST response.

## 3. Validation

- [ ] 3.1 [docs] Update `services/internal-contracts/secrets/README.md` to
      describe the security scheme, the pagination envelope, and the
      operator-only "list across tenants" mode.
- [ ] 3.2 [test] Run `corepack pnpm test:unit` plus the contract suite
      plus `openspec validate harden-m3-security-and-pagination --strict`;
      all green before merge.
