## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/backup-status/test/unit/trigger-restore-role-scope.test.mjs`
      with a case that passes a token whose `roles: ['superadmin']` but
      `scopes: []` and asserts the current implementation denies — proving B5
      at `services/backup-status/src/operations/trigger-restore.action.ts:279`.
- [ ] 1.2 [test] Add a sibling case for `initiate-restore.action.ts:20`,
      `confirm-restore.action.ts:21`, and `second-actor-verifier.ts:10`,
      proving B5 across all four enforcers.
- [ ] 1.3 [test] Add a manifest-conformance case asserting
      `services/keycloak-config/scopes/backup-scopes.yaml` has a `role_mappings:`
      entry for `backup:write:own`, proving B6 at `backup-scopes.yaml:9-15`.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/backup-status/src/auth/principal-checks.mjs`
      exporting `hasAuthorizedScope(token, scope)` and
      `hasAuthorizedRole(token, role)`; consume both from every enforcer.
- [ ] 2.2 [fix] Replace `token.scopes.includes('superadmin')` (and equivalent
      role-as-scope patterns) at `trigger-restore.action.ts:279`,
      `initiate-restore.action.ts:20`, `confirm-restore.action.ts:21`, and
      `second-actor-verifier.ts:10` with the helper pair.
- [ ] 2.3 [fix] Add the missing `role_mappings:` entry binding
      `backup:write:own` to `tenant_owner` and `workspace_admin` in
      `backup-scopes.yaml:9-15`.
- [ ] 2.4 [impl] Add `scripts/validate-no-role-in-scopes.mjs` (CI grep guard)
      that fails when any enforcer references a known realm-role literal
      inside `token.scopes.includes(...)`.

## 3. Docs and validation

- [ ] 3.1 [docs] Add `services/keycloak-config/README.md` (new) documenting the
      role-vs-scope distinction, the canonical helper, and the CI guard.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-b1-role-scope-separation --strict`; both green.
