## ADDED Requirements

### Requirement: CDC rate-limit window MUST be keyed by tenant and workspace

The system SHALL key each per-workspace rate-limit sliding window by the composite identifier `${tenantId}:${workspaceId}` so that workspaces belonging to different tenants are always tracked in separate, independent counters.

#### Scenario: Rate windows for same workspace id under different tenants are isolated

- **WHEN** two CDC events are published with identical `workspace_id` values but different `tenant_id` values
- **THEN** each event is evaluated against its own independent counter and the rate allowance consumed by one tenant does not affect the remaining allowance of the other

### Requirement: CDC rate-limit window map MUST evict idle entries

The system SHALL remove a rate-limit window entry from the in-process map when the entry's `windowStart` is more than one window duration (1 second) in the past and no new event has been observed in that window, ensuring the map does not grow unboundedly over the lifetime of the process.

#### Scenario: Idle window entries are removed after the window expires

- **WHEN** a CDC event is processed for a given `tenantId:workspaceId` composite key and no further events arrive for that key for at least one full window duration
- **THEN** the corresponding entry is absent from the rate-limit map on the next `_allow` evaluation cycle, and the map size does not increase monotonically with the number of distinct workspaces seen over time

#### Scenario: Active window entries are not prematurely evicted

- **WHEN** CDC events for a given `tenantId:workspaceId` composite key arrive at a rate within the allowed budget and within the same 1-second window
- **THEN** the entry remains in the map for the duration of the window and the counter accurately reflects all events seen in that window

### Requirement: `_allow` MUST accept tenantId as a required argument

The system SHALL update the `_allow(tenantId, workspaceId)` signature to require `tenantId` and SHALL NOT accept calls with `workspaceId` alone for the purpose of rate-limit lookup or update.

#### Scenario: publish passes both tenant and workspace to the rate-limit check

- **WHEN** `KafkaChangePublisher.publish` is called with a `captureConfig` that includes both `tenant_id` and `workspace_id`
- **THEN** `_allow` is invoked with both values and the composite key `${tenantId}:${workspaceId}` is used for all map operations
