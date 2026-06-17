# tenant-rbac — spec delta for fix-superadmin-created-disabled

## ADDED Requirements

### Requirement: Bootstrap superadmin user is created enabled and can log in immediately

The system SHALL create the superadmin user with `enabled: true`,
`emailVerified: true`, and no required actions so that the superadmin can log in
immediately after a fresh install without any manual intervention.

#### Scenario: Superadmin login succeeds immediately after fresh install

- **WHEN** the bootstrap Job completes on a fresh install
- **THEN** a login attempt for the superadmin user MUST return 201 with a valid
  `tokenSet` and MUST NOT return 401 `Account disabled`
