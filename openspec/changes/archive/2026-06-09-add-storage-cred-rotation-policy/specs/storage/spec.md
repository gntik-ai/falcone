# Storage

## ADDED Requirements

### Requirement: Per-tenant storage credential rotation policy

The system SHALL allow a per-tenant rotation policy to be configured that specifies
the maximum age (in days) for storage programmatic credentials and an optional
warn-before-expiry window, so that tenants can enforce a credential lifetime without
manual intervention.

#### Scenario: Tenant configures a storage credential rotation policy

- **WHEN** a tenant admin sets `maxStorageCredentialAgeDays: 90` and
  `storageCredentialWarnBeforeExpiryDays: 7` for their tenant
- **THEN** the policy is persisted scoped to that tenant and a subsequent GET for the
  same tenant returns the configured values

#### Scenario: Policy is isolated per tenant

- **WHEN** Tenant A configures `maxStorageCredentialAgeDays: 30` and Tenant B has no
  policy configured
- **THEN** a GET for Tenant B's policy does not return Tenant A's values and Tenant
  B's credentials are not subject to Tenant A's age limit

### Requirement: Storage credentials carry a policy-derived expiry

The system SHALL record a policy-derived `policyExpiresAt` timestamp on each active
storage programmatic credential, computed from `lastRotatedAt +
maxStorageCredentialAgeDays`, so that the credential record itself is the source of
truth for its expiry deadline.

#### Scenario: Newly issued credential reflects the active policy expiry

- **WHEN** a storage programmatic credential is issued for a tenant that has
  `maxStorageCredentialAgeDays: 60`
- **THEN** the credential record contains a `policyExpiresAt` equal to
  `createdAt + 60 days` and `secretVersion` is 1

#### Scenario: Credential without an active tenant policy has no policy expiry

- **WHEN** a storage programmatic credential is issued for a tenant that has no
  storage rotation policy configured
- **THEN** the credential record has `policyExpiresAt: null` and is subject only to
  its explicit `ttlSeconds` / `expiresAt` value

### Requirement: Scheduled sweep auto-rotates policy-expired storage credentials

The system SHALL execute a periodic sweep that identifies active storage programmatic
credentials whose `policyExpiresAt` has elapsed, auto-rotates each such credential
(incrementing `secretVersion`), and keeps the previous key valid during a grace
overlap period, so that consuming workloads have time to adopt the new key.

#### Scenario: Sweep rotates a credential past its policy expiry

- **WHEN** the storage-credential expiry sweep runs and finds an active credential
  whose `lastRotatedAt` is older than `maxStorageCredentialAgeDays`
- **THEN** the system increments `secretVersion`, sets `lastRotatedAt` to the current
  timestamp, and marks the previous-version key as valid until the grace-overlap
  window expires

#### Scenario: Sweep skips credentials within their policy window

- **WHEN** the storage-credential expiry sweep runs and a credential's
  `lastRotatedAt` is within the `maxStorageCredentialAgeDays` window
- **THEN** the credential is not rotated and its `secretVersion` is unchanged

#### Scenario: Sweep is a no-op for tenants without a rotation policy

- **WHEN** the storage-credential expiry sweep runs for a tenant that has no
  `maxStorageCredentialAgeDays` configured
- **THEN** none of that tenant's storage credentials are rotated by the sweep

### Requirement: Policy-triggered rotation emits a credential_rotation audit event

The system SHALL emit a `credential_rotation` audit event for every storage
credential rotation triggered by the expiry sweep, carrying `tenantId`,
`workspaceId`, `credentialId`, `rotationReason: "policy_expiry"`, and the new
`secretVersion`, so that rotation history is observable and auditable per tenant.

#### Scenario: Sweep rotation produces an audit event scoped to the owning tenant

- **WHEN** the sweep auto-rotates a storage credential belonging to Tenant A
- **THEN** a `credential_rotation` audit event is emitted with `tenantId` equal to
  Tenant A's ID, `rotationReason: "policy_expiry"`, and the updated `secretVersion`

#### Scenario: Manual rotation does not emit a policy_expiry audit event

- **WHEN** a tenant admin manually rotates a storage credential via the
  `rotateStorageProgrammaticCredential` route
- **THEN** the audit event emitted has `rotationReason: "manual"` and not
  `"policy_expiry"`
