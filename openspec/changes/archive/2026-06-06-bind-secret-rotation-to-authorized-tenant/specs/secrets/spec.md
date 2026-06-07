## ADDED Requirements

### Requirement: Secret rotation is authorized against the operated secret's recorded owner

The system SHALL authorize every secret-rotation initiate and revoke operation against the recorded owner `(domain, tenant_id)` of the operated `secretPath`, resolved server-side from `secret_metadata`. The system SHALL NOT authorize a rotation operation using a caller-supplied tenant identifier that is independent of the operated `secretPath`.

#### Scenario: Tenant owner cannot rotate another tenant's secret

- **WHEN** a `tenant-owner` whose verified tenant is `A` calls secret-rotation-initiate with `domain='tenant'`, `tenantId='A'`, and `secretPath` whose recorded owner is tenant `B`
- **THEN** the system returns a 403/404 error before any Vault write
- **AND** tenant `B`'s secret value in Vault is unchanged

#### Scenario: Tenant owner cannot revoke another tenant's secret version

- **WHEN** a `tenant-owner` whose verified tenant is `A` calls secret-rotation-revoke with `secretPath` whose recorded owner is tenant `B`
- **THEN** the system returns a 403/404 error before any Vault delete
- **AND** tenant `B`'s secret versions in Vault are unchanged

#### Scenario: Same-tenant rotation succeeds

- **WHEN** a `tenant-owner` whose verified tenant is `A` calls secret-rotation-initiate with a `secretPath` whose recorded owner is tenant `A`
- **THEN** the system performs the Vault write and records the new version state

### Requirement: Rotation repository queries are tenant-scoped

The system SHALL constrain every read and write in the secret-rotation repository to the verified tenant, so that version-state lookups and transitions for a `secretPath` cannot return or mutate rows owned by another tenant.

#### Scenario: Version-state lookup is scoped to the owning tenant

- **WHEN** the rotation repository resolves version state for a `secretPath`
- **THEN** the query restricts results to rows whose `tenant_id` matches the operated secret's recorded owner
