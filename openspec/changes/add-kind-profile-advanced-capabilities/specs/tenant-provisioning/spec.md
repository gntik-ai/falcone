# tenant-provisioning — spec delta for add-kind-profile-advanced-capabilities

## ADDED Requirements

### Requirement: Kind profile supports advanced capabilities via opt-in overlay

The system SHALL provide a `values-kind-advanced.yaml` overlay that enables realtime
(PG-table SSE at minimum), Temporal-backed workflows, and MCP hosting on a kind
cluster so that these capabilities can be exercised and tested without a production
deployment.

#### Scenario: Realtime SSE endpoint is reachable with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay
- **THEN** the realtime SSE endpoint (PG-table change stream) MUST respond to a
  subscription request and MUST deliver change events

#### Scenario: Workflow route returns non-501 with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay and Temporal
  is enabled
- **THEN** `GET /v1/flows` MUST return 200 (or the appropriate list response) and
  MUST NOT return 501 `Not implemented`
