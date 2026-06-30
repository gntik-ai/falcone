# web-console - spec delta for fix-777-events-console-routes

## MODIFIED Requirements

### Requirement: EventsConsole create-topic request uses the handler field

The EventsConsole page SHALL send create-topic requests to
`POST /v1/events/workspaces/{workspaceId}/topics` with the request-body field the kind control-plane
handler reads. When the user submits a topic name, the request body SHALL carry that value as
`name`, with optional topic settings such as `partitions`, so an authorized tenant owner can create
the topic and receive `201` instead of `400 VALIDATION_ERROR`.

#### Scenario: Create topic submits body.name

- **WHEN** a tenant owner submits create-topic with a name from the EventsConsole page
- **THEN** the request body carries `{ name: "<topic name>" }`
- **AND THEN** the handler reads the topic name and creates the topic with `201`
- **AND THEN** the response is not `400 VALIDATION_ERROR "topic name is required"`.
