## ADDED Requirements

### Requirement: Event publication is authorized against the authenticated caller's tenant and workspace

The system SHALL, during event publication validation, assert that the resolved topic's `tenantId` equals the authenticated caller's `context.tenantId` and that the resolved topic's `workspaceId` equals the authenticated caller's `context.workspaceId`. The system SHALL NOT proceed with publication when these values do not match. On mismatch the system SHALL return `authorization_error` mapped to HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`, with no event written to Kafka.

#### Scenario: Caller cannot publish to a topic owned by another tenant

- **WHEN** an authenticated caller whose `context.tenantId` is `tenant-a` submits a publication request referencing a topic whose `tenantId` is `tenant-b`
- **THEN** the system returns HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`
- **AND** no event is written to the Kafka topic

#### Scenario: Caller cannot publish to a topic in another workspace within the same tenant

- **WHEN** an authenticated caller whose `context.workspaceId` is `ws-1` submits a publication request referencing a topic whose `workspaceId` is `ws-2` (within the same tenant)
- **THEN** the system returns HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`
- **AND** no event is written to Kafka

#### Scenario: Same-tenant same-workspace publication succeeds

- **WHEN** an authenticated caller whose `context.tenantId` is `tenant-a` and `context.workspaceId` is `ws-1` submits a publication request to a topic owned by `tenant-a` / `ws-1`
- **THEN** the system accepts the publication and returns HTTP 202

### Requirement: Caller-supplied tenant and workspace fields are validated against authenticated context

The system SHALL compare the caller-supplied `tenantId` and `workspaceId` fields in the normalized publication request against the authenticated caller's `context.tenantId` and `context.workspaceId`. The system SHALL treat these request fields as untrusted and SHALL return `authorization_error` → HTTP 403 / `EVT_GATEWAY_FORBIDDEN` when either field does not match the authenticated context value. The system SHALL NOT use request-supplied tenant or workspace values to perform routing or scoping decisions unless they have first been validated against the authenticated context.

#### Scenario: Request with mismatched tenantId field is rejected before topic resolution

- **WHEN** an authenticated caller whose `context.tenantId` is `tenant-a` submits a publication request with `tenantId` set to `tenant-b` in the request body
- **THEN** the system returns HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`
- **AND** the mismatched `tenantId` value is not used for topic lookup or event routing

#### Scenario: Request with mismatched workspaceId field is rejected

- **WHEN** an authenticated caller whose `context.workspaceId` is `ws-1` submits a publication request with `workspaceId` set to `ws-99`
- **THEN** the system returns HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`

### Requirement: Topic reference resolution prefers authenticated context over caller-supplied values

The system SHALL resolve the topic reference used for event routing from the authenticated caller's context rather than preferring a caller-supplied `topicRef`. Where the caller supplies a `topicRef`, the system SHALL validate it against the authenticated context before using it; a `topicRef` that resolves to a topic not owned by the authenticated caller's tenant and workspace MUST be rejected with HTTP 403 `EVT_GATEWAY_FORBIDDEN`.

#### Scenario: Caller-supplied topicRef for another tenant's topic is rejected

- **WHEN** an authenticated caller whose `context.tenantId` is `tenant-a` supplies a `topicRef` that resolves to a topic owned by `tenant-b`
- **THEN** the system returns HTTP 403 with error code `EVT_GATEWAY_FORBIDDEN`
- **AND** the event is not published to `tenant-b`'s topic

#### Scenario: Caller-supplied topicRef for own tenant's topic is accepted

- **WHEN** an authenticated caller whose `context.tenantId` is `tenant-a` supplies a `topicRef` that resolves to a topic owned by `tenant-a` and workspace matching `context.workspaceId`
- **THEN** the system proceeds with publication and returns HTTP 202
