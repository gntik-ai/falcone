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

#### Scenario: Flows API responds with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay (Temporal +
  workflow-worker up and `TEMPORAL_ADDRESS` set on the executor)
- **THEN** the workspace-scoped Flows endpoints (`GET /v1/flows/workspaces/{ws}/task-types`
  and `GET /v1/flows/workspaces/{ws}/flows`) MUST return 200 with a list response and
  MUST NOT return 404 / 501

#### Scenario: MCP hosting routes are registered with the advanced kind profile

- **WHEN** the chart is installed with the advanced kind values overlay (`MCP_ENABLED=true`)
- **THEN** `GET /v1/mcp/workspaces/{ws}/servers` MUST be a registered route returning 200
  (not 404)
