## ADDED Requirements

### Requirement: Workspace storage activation provisions a real SeaweedFS S3 identity

The system SHALL, upon activating a tenant workspace's storage boundary, call the SeaweedFS IAM API (`s3.configure`) to create a new S3 identity whose `accessKey` and `secretKey` are unique to that workspace, persist `accessKeyIdMasked` and `secretVersion` in the storage credential record, and deliver the plaintext `secretKey` exactly once through `buildStorageProgrammaticCredentialSecretEnvelope` — never persisting the plaintext secret.

Evidence: `services/adapters/src/storage-tenant-context.mjs:465-469` (`provisionWorkspaceStorageBoundary` is a `NOT_YET_IMPLEMENTED` stub); `services/adapters/src/storage-programmatic-credentials.mjs:138-144` (keys are SHA-256-derived and never written to a backend); `deploy/kind/control-plane/storage-handlers.mjs:13-14` (single shared root credential for all tenants).

#### Scenario: Workspace storage activation creates a SeaweedFS identity

- **WHEN** the provisioning orchestrator calls `provisionWorkspaceStorageBoundary` for a new workspace
- **THEN** the system MUST issue an `s3.configure` write to SeaweedFS creating a new identity with a unique `accessKey`/`secretKey`, persist `accessKeyIdMasked` and `secretVersion: 1` in the credential record, and return a one-time secret envelope — no plaintext secret is written to the database

#### Scenario: Duplicate provisioning does not create a second identity

- **WHEN** `provisionWorkspaceStorageBoundary` is called for a workspace that already has an active SeaweedFS identity
- **THEN** the system MUST return the existing credential record without creating a duplicate SeaweedFS identity and without delivering a new secret envelope

### Requirement: Per-tenant SeaweedFS identity is scoped to the tenant's own bucket(s)

The system SHALL, when writing a SeaweedFS S3 identity, set the `actions` and `buckets` fields so that the identity can only perform the operations permitted by the in-process `storage-access-policy` decisions on the tenant's own bucket(s)/prefix(es) — and is denied access to all other buckets by SeaweedFS, not only by application-layer guards.

Evidence: `services/adapters/src/storage-access-policy.mjs` (in-process policy engine, never serialised to a backend); `workspace_buckets` Postgres table (bucket-per-workspace mapping, exercised by `add-seaweedfs-bucket-lifecycle-migration`).

#### Scenario: Tenant key restricted to own bucket actions in SeaweedFS identity config

- **WHEN** a workspace storage identity is provisioned or rotated
- **THEN** the SeaweedFS identity MUST carry `buckets` containing only that workspace's bucket name and `actions` derived from the storage-access-policy engine (e.g., `["Read","Write","List"]`) — no wildcard bucket entry is written

#### Scenario: Policy downgrade removes write action from SeaweedFS identity

- **WHEN** a tenant admin changes the workspace storage policy to read-only
- **THEN** the system MUST update the SeaweedFS identity's `actions` field to remove `Write` and reload the identity so the change takes effect immediately without requiring key rotation

### Requirement: Storage credential rotation writes the new key to SeaweedFS and reloads

The system SHALL, for both manual rotation (`rotateStorageProgrammaticCredential`) and policy-sweep-triggered rotation (`storage-credential-expiry-sweep.mjs`), generate a new `accessKey`/`secretKey` pair, write it to the SeaweedFS identity via `s3.configure`, trigger an identity reload, increment `secretVersion`, and keep the previous-version key valid until the grace-overlap window expires.

Evidence: `services/adapters/src/storage-programmatic-credentials.mjs` (`rotateStorageProgrammaticCredential`, `rotateTenantStorageContextCredential`); `services/provisioning-orchestrator/src/migrations/090-storage-credential-rotation-policy.sql` (policy schema).

#### Scenario: Manual rotation issues a new key to SeaweedFS

- **WHEN** a tenant admin calls the rotate endpoint for an active storage credential
- **THEN** the system MUST write the new `accessKey`/`secretKey` to the SeaweedFS identity, trigger a reload, increment `secretVersion`, and deliver the new secret once — the old key MUST remain valid until the grace-overlap window expires

#### Scenario: Policy-sweep rotation writes the new key to SeaweedFS

- **WHEN** the storage-credential expiry sweep finds a credential whose `policyExpiresAt` has elapsed
- **THEN** the system MUST rotate the SeaweedFS identity (new key + reload), increment `secretVersion`, and emit a `credential_rotation` audit event with `rotationReason: "policy_expiry"`

#### Scenario: Old key is rejected by SeaweedFS after the grace window closes

- **WHEN** the grace-overlap window following a rotation has expired
- **THEN** SeaweedFS MUST reject requests signed with the previous-version `accessKey` with an authentication error, and the system MUST have removed the previous key from the identity

### Requirement: Explicit and cascade credential revocation removes the SeaweedFS identity

The system SHALL, upon explicit revocation (`revokeStorageProgrammaticCredential`) or a lifecycle cascade that sets `cascadesCredentialRevocation`, delete the SeaweedFS S3 identity and trigger an identity reload so the revoked key is immediately rejected by SeaweedFS.

Evidence: `services/adapters/src/storage-programmatic-credentials.mjs` (`revokeStorageProgrammaticCredential`); `services/adapters/src/storage-tenant-context.mjs` (`cascadesCredentialRevocation`).

#### Scenario: Explicit revocation removes the identity from SeaweedFS

- **WHEN** a tenant admin explicitly revokes a storage programmatic credential
- **THEN** the system MUST delete the corresponding SeaweedFS identity entry via `s3.configure`, trigger a reload, and mark the credential record as revoked — any subsequent S3 request signed with the revoked key MUST be rejected by SeaweedFS

#### Scenario: Lifecycle cascade revocation cleans up the SeaweedFS identity

- **WHEN** a workspace or tenant is deleted and `cascadesCredentialRevocation` is triggered
- **THEN** the system MUST delete all SeaweedFS identities associated with that workspace/tenant and trigger a reload before the deletion is considered complete
