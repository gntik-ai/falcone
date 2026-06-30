# web-console Specification (delta)

## ADDED Requirements

### Requirement: Operations query schema is applied before serving the route

The system SHALL ensure the provisioning-orchestrator schema, including
`async_operations` and related tables/migrations 073+, is applied wherever
`/v1/async-operation-query` is served, so operations query returns 200 instead of
missing-relation 500.

#### Scenario: Console lists async operations after control-plane deployment

- **WHEN** the control-plane is deployed and the console queries async operations
  (`POST /v1/async-operation-query {queryType:list,filters:{},pagination:{limit:20,offset:0}}`)
- **THEN** the `async_operations` table exists and the query returns a 200 result set
  (empty if none), with no missing-relation 500.
