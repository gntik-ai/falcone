# Storage fixture requirements

## ADDED Requirements

### Requirement: Per-run disposable fixture setup

E2E consumers SHALL create disposable buckets through
`POST /v1/storage/workspaces/{workspaceId}/buckets`, using the existing fixture
identity and base URL configuration. Setup SHALL require HTTP 201 and SHALL
request `e2e-<purpose>-<runId>`, with a unique run ID retained within the entire
40-character requested-name fragment. Consumers MUST use the returned
`bucket.resourceId` and MUST NOT construct bucket IDs.

#### Scenario: Successful setup and safe handoff

- **WHEN** the authorized fixture identity provisions a bucket and receives 201
- **THEN** setup SHALL return only `bucketId` and relative `objectPrefix` information
- **AND** handoff serialization SHALL discard all other fields
- **AND** `storageCredential`, access keys, secret keys and bearer tokens SHALL NOT be logged, traced, attached, or persisted in the handoff

#### Scenario: Provisioning is denied or quota is exhausted

- **WHEN** provisioning returns 403 or 409 STORAGE_QUOTA_EXCEEDED
- **THEN** the smoke SHALL fail or explicitly skip with the permission/quota reason
- **AND** it SHALL NOT silently pass or substitute a guessed name

### Requirement: Public object I/O and isolation

The handoff SHALL support public object PUT, GET, list and DELETE with the
tenant/workspace bearer identity, without Storage mocks or shared S3 credentials.

#### Scenario: Store and discard a partial artifact

- **WHEN** the consumer uploads bytes to the returned bucket ID
- **THEN** GET SHALL return identical bytes and list SHALL contain the key
- **AND** DELETE SHALL succeed and subsequent object GET SHALL return 404

#### Scenario: Denial does not disclose bucket existence

- **WHEN** TENANT_B requests GET, PUT or list against the fixture bucket
- **THEN** each response SHALL be 404 with the same normalized error as an unprovisioned name
- **AND** no-token requests SHALL return 401
- **AND** the owner's requests to an unprovisioned name such as wiki-artifacts SHALL return 404

### Requirement: Bounded cleanup and stale-fixture sweep

Teardown SHALL delete fixture objects, then the fixture bucket, through public
DELETE routes. It SHALL run in finally/afterAll even after consumer failure,
SHALL be idempotent, and SHALL leave other fixtures and runs untouched.

#### Scenario: Teardown after failure or repeated teardown

- **WHEN** a consumer fails, or teardown is called repeatedly
- **THEN** the bucket SHALL be absent from GET /v1/storage/buckets
- **AND** object GET SHALL return 404
- **AND** another concurrent fixture's object SHALL remain readable

#### Scenario: Explicit stale-fixture sweep

- **WHEN** the caller invokes the sweep with a positive TTL (default 24 hours)
- **THEN** it SHALL select only its own tenant/workspace buckets with the generated e2e fixture prefix and run-ID format and a server creation timestamp strictly older than the TTL
- **AND** fresh, non-prefixed, foreign-workspace, foreign-tenant and undated buckets SHALL remain untouched

### Requirement: Offline compatibility

Live specs SHALL preserve the existing LIVE GATE skip pattern without a live
identity or Storage stack. Offline contract tests SHALL verify naming bounds
and uniqueness, credential-free serialization and fail-closed sweep selection.
