# events - spec delta for fix-777-events-console-routes

## ADDED Requirements

### Requirement: EventsConsole workspace topic routes are served

The system SHALL serve the workspace-scoped routes the EventsConsole page calls so a tenant owner
can list, publish to, and consume from event topics in an owned workspace. These routes SHALL
resolve to real handlers rather than `404 NO_ROUTE`:

- `GET /v1/events/workspaces/{workspaceId}/topics`
- `POST /v1/events/workspaces/{workspaceId}/topics/{topic}/publish`
- `GET /v1/events/workspaces/{workspaceId}/topics/{topic}/messages`

The system SHALL resolve the path workspace to a workspace owned by the verified caller's tenant
before listing topics, publishing, or consuming messages. A foreign workspace SHALL be hidden as
not found and SHALL NOT reveal topic rows.

#### Scenario: Events data page lists owned workspace topics

- **WHEN** a tenant owner opens `/console/events/data`
- **THEN** `GET /v1/events/workspaces/{ws}/topics` resolves to a real handler
- **AND THEN** the response is not `404 NO_ROUTE`
- **AND THEN** the response body is `{ items: [...] }` with topic records compatible with the
  EventsConsole topic list.

#### Scenario: Events data page publishes to and consumes from a logical topic

- **WHEN** a tenant owner publishes to a topic via the EventsConsole page
- **THEN** `POST /v1/events/workspaces/{ws}/topics/{topic}/publish` resolves to a real handler
- **AND THEN** the response is not `404 NO_ROUTE`.

- **WHEN** a tenant owner consumes from a topic via the EventsConsole page
- **THEN** `GET /v1/events/workspaces/{ws}/topics/{topic}/messages` resolves to a real handler
- **AND THEN** the response is not `404 NO_ROUTE`
- **AND THEN** the response body is `{ items: [{ key, value, partition, offset, timestamp }] }`.

#### Scenario: Tenant caller requests a foreign workspace event route

- **WHEN** a tenant-scoped caller requests an EventsConsole workspace topic route for a workspace
  owned by another tenant
- **THEN** the route returns `404 WORKSPACE_NOT_FOUND`
- **AND THEN** it does not query or reveal that workspace's topic rows.
