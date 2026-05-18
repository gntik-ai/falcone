## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/secret-metadata-schema.test.mjs` that
      validates `secret-metadata-v1.yaml` with `@apidevtools/swagger-parser`
      and asserts a sample response missing `name` is rejected (proves B3
      is fixed).
- [ ] 1.2 [test] Add a case that validates a sample detail response with
      `lastAccessedAt: null` against the schema and asserts it validates
      under both 3.0.3 (`nullable: true`) and 3.1.0 (`type: [string, 'null']`)
      forms (proves B4 is fixed).
- [ ] 1.3 [test] Add a case that constructs the detail-route URL for the
      secret path `platform/postgresql/app-password` against the corrected
      `GET /v1/secrets/{domain}?path=...` shape and asserts it matches
      (proves B5 is fixed).
- [ ] 1.4 [test] Add a case that submits a sample detail response carrying
      `value: "abc"` or `data: {...}` and asserts both YAMLs reject it via
      `not.anyOf` (proves B6 is fixed).

## 2. Implementation

- [ ] 2.1 [fix] Edit `services/internal-contracts/secrets/secret-metadata-v1.yaml`
      to (a) replace `paths['/v1/secrets/{domain}/{path}']` with
      `paths['/v1/secrets/{domain}']` carrying a required query parameter
      `path: {in: query, required: true, schema: {type: string, minLength: 1}}`,
      (b) add the `required` array to the 200 response, (c) set `lastAccessedAt`
      `nullable: true`, (d) add the `not.anyOf` clause matching the inventory.
- [ ] 2.2 [fix] Edit `services/internal-contracts/secrets/secret-inventory-v1.yaml`
      to align `SecretMetadataItem` casing/key vocabulary with the corrected
      detail response so consumers can rely on a single field-name set across
      both routes.
- [ ] 2.3 [fix] If `apps/control-plane/openapi/families/secrets.openapi.json`
      exists (added by `complete-m3-endpoint-implementation`), regenerate it
      from the corrected YAMLs and re-merge into `control-plane.openapi.json`.
- [ ] 2.4 [impl] Update the M2 secret-audit-handler's JS schema constant at
      `services/secret-audit-handler/src/schema.mjs` so the `not.anyOf`
      forbidden-field set matches the unified YAML clause (resolves the
      cross-audit drift called out by M2 B7).

## 3. Validation

- [ ] 3.1 [docs] Update `services/internal-contracts/secrets/README.md` to
      describe the corrected route shape and the unified forbidden-field
      policy.
- [ ] 3.2 [test] Run `corepack pnpm test:unit` plus
      `openspec validate fix-m3-contract-schema-conformance --strict`; both
      green before merge.
