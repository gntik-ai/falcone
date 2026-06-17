# Tasks — fix-superadmin-created-disabled

## Implementation
- [x] Locate the superadmin create payload (`bootstrap.oneShot.keycloak.superadmin` in
  `charts/in-falcone/values.yaml`); confirm a UserRepresentation POSTed without `enabled` is
  created DISABLED by Keycloak (campaign A1: login 401 "Account disabled").
- [x] Set `enabled: true`, `emailVerified: true`, `requiredActions: []` on the payload.
- [x] Add an idempotent patch step (`bootstrap-script-configmap.yaml`): PUT the enabled account
  state to the user resource before the password reset, healing an already-disabled superadmin on
  an existing deployment (create-only provisioning never updates a user).

## Verification
- [x] Black-box test `tests/blackbox/superadmin-created-enabled.test.mjs` (bbx-a1-01/02) asserts
  the rendered payload + script via `helm template`.
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-superadmin-created-disabled --strict`.

## Archive
- [x] `/opsx:archive fix-superadmin-created-disabled`
