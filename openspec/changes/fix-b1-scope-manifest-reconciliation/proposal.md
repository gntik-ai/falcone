## Why

The `services/keycloak-config/scopes/` directory and the chart-driven Keycloak
bootstrap path under `charts/in-falcone/` describe overlapping authorization
concepts (realm roles, client scopes) with no cross-reference and no
reconciliation. The result is that the only Keycloak provisioning that actually
runs at install time creates none of the authorization scopes the YAML
manifests declare. From `openspec/audit/cap-b1-keycloak-realm-scope-configuration.md`:

- **B1** (`services/keycloak-config/scopes/backup-audit-scopes.yaml:7`,
  `backup-operations-scopes.yaml:10`, `backup-scopes.yaml:13`,
  `backup-status-scopes.yaml:14` vs `charts/in-falcone/values.yaml:274-289`) —
  every manifest binds scopes to a realm role named `sre`, but the chart-driven
  role creator builds `platform_admin`, `platform_operator`, `platform_auditor`
  instead. `sre` is a phantom role.
- **B2** (`charts/in-falcone/templates/bootstrap-payload-configmap.yaml:25-28`
  vs `charts/in-falcone/values.yaml:290-359`) — bootstrap reads scopes from
  `.Values.bootstrap.oneShot.keycloak.clientScopes`, which contains only the
  four identity-context scopes. None of the nine authorization scopes the YAML
  manifests declare is provisioned. Every protected endpoint reaches its 403
  path on a fresh install.
- **B3** (`tests/unit/backup-restore-sandbox.test.mjs:121`) and
  `services/backup-status/test/integration/backup-operations-api.test.ts:26`
  pass `'backup:read:global'` in the token's `scopes` array. No YAML declares
  this scope — undeclared in production, asserted in tests.
- **B4** — three incompatible YAML shapes:
  `backup-audit-scopes.yaml:6-8` uses inline `roles:` per scope while
  `backup-operations-scopes.yaml:9-15` and `backup-scopes.yaml:9-18` use a
  separate top-level `role_mappings:` block; no schema, no validator.
- **B9** — the two configuration sources (`services/keycloak-config/scopes/*.yaml`
  and `charts/in-falcone/values.yaml::bootstrap.oneShot.keycloak.*`) were
  authored independently and never reconciled.

## What Changes

- Promote `services/keycloak-config/scopes/*.yaml` to the source-of-truth for
  authorization scopes and role mappings; rewrite every file to one canonical
  schema with `scopes:` and `role_mappings:` blocks.
- Add a `scripts/reconcile-keycloak-scopes.mjs` generator that emits
  `values.yaml::bootstrap.oneShot.keycloak.clientScopes` and a TypeScript
  scope-constants module consumed by enforcers; rerun on every release.
- Reconcile the role taxonomy: either remove `sre` from the manifests and
  bind to existing realm roles, or add `sre` to `values.yaml:274-289`. The
  manifest and the realm-role list MUST list the same set.
- Add `'backup:read:global'` (or remove the test-fixture usage) so that every
  scope literal referenced in tests is declared in a manifest.

## Capabilities

### Modified Capabilities

- `identity-and-access`: reconciliation of authorization-scope manifests with
  the Keycloak-bootstrap realm-role and client-scope provisioning, and a
  generated single source-of-truth consumed by enforcers and Helm values.

## Impact

- Affected code: `services/keycloak-config/scopes/backup-audit-scopes.yaml`,
  `services/keycloak-config/scopes/backup-operations-scopes.yaml`,
  `services/keycloak-config/scopes/backup-scopes.yaml`,
  `services/keycloak-config/scopes/backup-status-scopes.yaml`,
  `charts/in-falcone/values.yaml`,
  `charts/in-falcone/templates/bootstrap-payload-configmap.yaml`,
  `tests/unit/backup-restore-sandbox.test.mjs`,
  `services/backup-status/test/integration/backup-operations-api.test.ts`,
  `scripts/reconcile-keycloak-scopes.mjs` (new).
- Migrations: tokens issued before the bootstrap is rerun continue to lack
  the authorization scopes; cluster operators MUST re-run the bootstrap job.
- Breaking changes: the role name change (`sre` → realm-role taxonomy or
  vice versa) requires a coordinated update to enforcement code that records
  `requesterRole: 'sre'` (`trigger-backup.action.ts:129`).
- Out of scope: role/scope separation in enforcement code (covered by
  `harden-b1-role-scope-separation`); pagination and validator infrastructure
  (covered by `harden-b1-bootstrap-pagination-and-validator`).
