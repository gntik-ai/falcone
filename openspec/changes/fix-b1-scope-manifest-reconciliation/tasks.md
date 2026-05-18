## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `tests/contracts/scope-manifest-reconciliation.test.mjs`
      that loads `services/keycloak-config/scopes/*.yaml` and
      `charts/in-falcone/values.yaml` and asserts every realm role named in a
      manifest exists in `values.yaml:274-289`, proving B1 (`sre` phantom role).
- [ ] 1.2 [test] Add a case that loads `bootstrap-payload-configmap.yaml:25-28`
      and asserts every scope declared in
      `services/keycloak-config/scopes/*.yaml` appears in
      `.Values.bootstrap.oneShot.keycloak.clientScopes`, proving B2.
- [ ] 1.3 [test] Add a case that grep-loads every test fixture's token
      `scopes` field and asserts each literal is declared in a manifest,
      proving B3 from `tests/unit/backup-restore-sandbox.test.mjs:121`.
- [ ] 1.4 [test] Add a case that loads each YAML in
      `services/keycloak-config/scopes/` and asserts it conforms to the
      canonical schema, proving B4 from `backup-audit-scopes.yaml:6-8` vs
      `backup-operations-scopes.yaml:9-15`.

## 2. Implementation

- [ ] 2.1 [spec] Define the canonical YAML schema for scope manifests
      (`scopes:` and `role_mappings:` blocks) and rewrite all four files in
      `services/keycloak-config/scopes/` to it.
- [ ] 2.2 [migration] Reconcile the role taxonomy: update
      `charts/in-falcone/values.yaml:274-289` (or the manifests) so the set
      of roles is consistent; update
      `services/backup-status/src/operations/trigger-backup.action.ts:129`
      to record the canonical name.
- [ ] 2.3 [impl] Add `scripts/reconcile-keycloak-scopes.mjs` that reads
      `services/keycloak-config/scopes/*.yaml` and emits
      `charts/in-falcone/values.yaml::bootstrap.oneShot.keycloak.clientScopes`
      plus a TypeScript constants module; wire into `package.json`.
- [ ] 2.4 [fix] Add `'backup:read:global'` to the appropriate manifest, or
      remove the literal from
      `tests/unit/backup-restore-sandbox.test.mjs:121` and
      `services/backup-status/test/integration/backup-operations-api.test.ts:26`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the new source-of-truth and generator flow in
      `services/keycloak-config/README.md` (new).
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate fix-b1-scope-manifest-reconciliation --strict`; both
      green.
