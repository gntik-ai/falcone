## ADDED Requirements

### Requirement: Public collection and table change streams

The routing specification, taxonomy, route catalog and OpenAPI SHALL publish GET
operations at:

- `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes`
- `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes`

#### Scenario: Collection stream with a workspace anon key

- **WHEN** a verified anon key is supplied through `?apikey=` for its own workspace
- **THEN** the enabled collection executor returns HTTP 200 `text/event-stream`
- **AND** insert, document update and delete produce `insert`, `replace`, `delete`
  events with `{type, documentId, document}`, never `update`
- **AND** another workspace of the same tenant receives none of those changes.

#### Scenario: Authorized table stream

- **WHEN** the API key's database role has schema USAGE and table SELECT on an
  existing RLS-disabled table in a dedicated workspace database
- **THEN** the enabled table executor returns HTTP 200 `text/event-stream`
- **AND** INSERT, UPDATE and DELETE produce `insert`, `update`, `delete` events
  with `{type, documentId, document}`, never `replace`
- **AND** another workspace of the same tenant receives none of those changes.

### Requirement: Executor authentication and pre-stream authorization

The executor dispatcher SHALL remain authoritative. The OpenAPI SHALL document
credential precedence and supported credentials.

#### Scenario: Missing or unverifiable selected credential

- **WHEN** there is no credential, or only an unverifiable `flc_` query key
- **THEN** the response is JSON HTTP 401 `UNAUTHENTICATED` without stream bytes
- **AND** a selected invalid header API key takes precedence over a valid query key
- **AND** non-`flc_` query values are ignored
- **AND** verified bearer sessions remain accepted when no API key is selected.

#### Scenario: Credential workspace mismatch

- **WHEN** a key bound to workspace A requests a stream in workspace B
- **THEN** the response is JSON HTTP 403 `FORBIDDEN` without starting the stream
- **AND** no workspace B events reach that caller.

#### Scenario: Table authorization refusal

- **WHEN** the table does not exist, the role lacks schema USAGE or table SELECT,
  an API-key identity requests an RLS-enabled table, or the database resolver
  returns a shared fallback
- **THEN** authorization returns JSON HTTP 403 or 404 before SSE headers
- **AND** no CREATE FUNCTION or CREATE TRIGGER executes
- **AND** catalog schema, table and role arguments are parameterized
- **AND** quoted, encoded and unsupported table identifiers are refused.

#### Scenario: Initialization failure and disabled executor

- **WHEN** authorization completes but initialization fails, such as with
  `WORKSPACE_DB_UNRESOLVED`
- **THEN** HTTP 200 precedes one `event: error` frame containing a code, and the
  stream ends
- **WHEN** the executor is unset
- **THEN** JSON HTTP 501 `REALTIME_DISABLED` is returned before stream bytes
- **AND** both behaviors are documented in OpenAPI.

### Requirement: Bounded gateway exception

Only `realtime-changes` SHALL be exempt from openid-connect and request-validation.
The exception SHALL require cors, limit-count rejecting with HTTP 429,
client-control, proxy-rewrite blanking `x-tenant-id`, `x-workspace-id`,
`x-auth-subject`, `x-actor-roles`, and setting `x-gateway-auth`. The route SHALL
require a URI constraint ending in `/changes$` and GET/OPTIONS only. Header and
query API keys SHALL contribute to the configured rate-limit key.

#### Scenario: Policy validation and routing

- **WHEN** the paired chart values contain the complete bounded route
- **THEN** gateway-policy validation passes
- **WHEN** header blanking or the URI constraint is missing, or another family
  omits its required authentication or request-validation plugin
- **THEN** validation fails
- **AND** OPTIONS is answered by cors without invoking the executor
- **AND** POST, PUT, PATCH, DELETE and HEAD do not reach the executor
- **AND** mongo-captures management routes continue matching their own route.

#### Scenario: Conditional deployed acceptance

- **WHEN** paired chart routing and #1118 log redaction are installed in staging
- **THEN** both source-specific event sequences and the 401/403 cases pass through
  the gateway, query keys are absent from logs, and inventory `endpoints[224]` is OK.
