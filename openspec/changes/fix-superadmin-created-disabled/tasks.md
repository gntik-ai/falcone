# Tasks — fix-superadmin-created-disabled

## Implementation
- [ ] Locate the superadmin user creation payload in the bootstrap script /
  `services/keycloak-config/`.
- [ ] Set `enabled: true`, `emailVerified: true`, `requiredActions: []`.
- [ ] Add an idempotent patch step for existing deployments.

## Verification
- [ ] Fresh install → superadmin login succeeds without manual intervention.
- [ ] Run `/opsx:verify fix-superadmin-created-disabled`.

## Archive
- [ ] `/opsx:archive fix-superadmin-created-disabled`
