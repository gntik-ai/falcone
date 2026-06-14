## ADDED Requirements

### Requirement: Per-tenant storage credentials enforce cross-tenant denial at the SeaweedFS S3 layer

The system SHALL ensure that each tenant's SeaweedFS S3 identity is scoped exclusively to that tenant's bucket(s) so that cross-tenant access is denied by SeaweedFS at the S3 authentication/authorisation layer — not only by application-layer guards — meaning that a key issued for Tenant A's workspace is cryptographically incapable of accessing Tenant B's bucket even if the application layer is bypassed or misconfigured.

Evidence: `deploy/kind/control-plane/storage-handlers.mjs:13-14` (today all tenants share a single root credential — a shared credential cannot enforce per-tenant bucket isolation at the S3 layer); `services/adapters/src/storage-access-policy.mjs` (in-process policy engine, never serialised to a SeaweedFS backend); `services/adapters/src/storage-tenant-context.mjs:465-469` (`provisionWorkspaceStorageBoundary` stub — no real identity is ever created).

#### Scenario: Cross-tenant probe — Tenant A's key is rejected for Tenant B's bucket

- **WHEN** Tenant A has an active SeaweedFS S3 identity scoped to bucket `ten-a-ws-1` and issues an S3 `GetObject` request targeting bucket `ten-b-ws-1` (owned by Tenant B) using Tenant A's `accessKey`/`secretKey`
- **THEN** SeaweedFS MUST return an S3 `AccessDenied` error for that request — the denial MUST originate from SeaweedFS identity/bucket scoping, not from any application-layer filter

#### Scenario: Tenant A's key cannot list Tenant B's bucket contents

- **WHEN** Tenant A's S3 identity is provisioned with `buckets: ["ten-a-ws-1"]` and Tenant A issues an S3 `ListObjectsV2` against `ten-b-ws-1`
- **THEN** SeaweedFS MUST return `AccessDenied` and MUST NOT return any object keys belonging to Tenant B's bucket

#### Scenario: Absent or empty bucket scoping is rejected at identity write time

- **WHEN** the SeaweedFS IAM client attempts to write a new S3 identity with an empty `buckets` list or a wildcard (`*`) bucket entry
- **THEN** the system MUST reject the identity write with a configuration error before issuing the `s3.configure` call, so that an improperly scoped identity is never created
