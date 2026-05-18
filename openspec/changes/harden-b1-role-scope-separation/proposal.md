## Why

Enforcement code under `services/backup-status/` conflates realm roles with
authorization scopes, and the manifests miss a role binding for one of the
per-tenant write scopes. From `openspec/audit/cap-b1-keycloak-realm-scope-configuration.md`:

- **B5** (`services/backup-status/src/operations/trigger-restore.action.ts:279`)
  — the check is `token.scopes.includes('backup:restore:global') ||
  token.scopes.includes('superadmin')`. `superadmin` is a **realm role**, not a
  scope. The gateway propagates roles into a separate header
  (`charts/in-falcone/templates/bootstrap-payload-configmap.yaml:140-141`); a
  real superadmin without `backup:restore:global` is denied. Same pattern in
  `initiate-restore.action.ts:20`, `confirm-restore.action.ts:21`,
  `second-actor-verifier.ts:10`.
- **B6** (`services/keycloak-config/scopes/backup-scopes.yaml:9-15`) —
  `role_mappings:` maps only `sre` and `superadmin` to `:global` scopes.
  `backup:write:own` (`:2-3`) has no role binding, despite
  `trigger-backup.action.ts:55-57` requiring it for the per-tenant write
  path and `:129` recording `requesterRole: 'tenant_owner'` when not global.
- **G6** — same conflation as B5; flagged as a gap because role-vs-scope
  separation is a cross-cutting authorization invariant.

## What Changes

- Introduce a single helper `hasAuthorizedScope(token, scope)` /
  `hasAuthorizedRole(token, role)` consumed by every enforcer; remove every
  `token.scopes.includes('<role-name>')` pattern from
  `trigger-restore.action.ts`, `initiate-restore.action.ts`,
  `confirm-restore.action.ts`, `second-actor-verifier.ts`.
- Add a CI grep guard (`scripts/validate-no-role-in-scopes.mjs`) that fails on
  any `token.scopes.includes('superadmin'|'sre'|'platform_*'|'tenant_*'|
  'workspace_*')` pattern.
- Add a `role_mappings:` entry binding `backup:write:own` to `tenant_owner`
  and `workspace_admin` in `backup-scopes.yaml:9-15` to match the enforcement
  expectation at `trigger-backup.action.ts:55-57, 129`.
- Document the role-vs-scope distinction in `services/keycloak-config/README.md`.

## Capabilities

### Modified Capabilities

- `identity-and-access`: enforcement of the role-vs-scope distinction and
  explicit role bindings for every declared per-tenant write scope.

## Impact

- Affected code:
  `services/backup-status/src/operations/trigger-restore.action.ts`,
  `services/backup-status/src/api/initiate-restore.action.ts`,
  `services/backup-status/src/api/confirm-restore.action.ts`,
  `services/backup-status/src/confirmations/second-factor/second-actor-verifier.ts`,
  `services/keycloak-config/scopes/backup-scopes.yaml`,
  `scripts/validate-no-role-in-scopes.mjs` (new).
- Migrations: none (schema change is YAML-only).
- Breaking changes: a token bearing `realm_access.roles: ['superadmin']` and
  no `backup:restore:global` scope that previously slipped through under the
  conflated check will now be denied — intended behaviour; the operator MUST
  assign the scope explicitly to that role.
- Out of scope: phantom-role reconciliation (covered by
  `fix-b1-scope-manifest-reconciliation`).
