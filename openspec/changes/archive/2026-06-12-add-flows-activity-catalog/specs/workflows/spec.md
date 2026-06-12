## ADDED Requirements

### Requirement: Task-type registry
The system SHALL maintain a task-type registry that maps each task type name (string, e.g. `db.query`) to its Temporal activity implementation, its JSON Schema for the input envelope, and its JSON Schema for the output envelope. The registry SHALL be the single authoritative source consumed by DSL validation and the console palette. The registry's `resolveActivity` lookup SHALL reject an unknown task type name with error code `UNKNOWN_TASK_TYPE`. DSL validation (the control-plane validate/publish endpoint, fed the registry's task-type names as its `taskTypeCatalog`) SHALL reject a workflow definition that references an unknown task type at validation time with HTTP 422 and validation error code `FLW-E006`, persisting no workflow.

#### Scenario: Known task type accepted
- **WHEN** a workflow definition references task type `db.query`
- **THEN** the registry resolves it to the corresponding activity and its schemas without error, and DSL validation passes

#### Scenario: Unknown task type rejected
- **WHEN** a workflow definition references a task type name not present in the registry (e.g. `db.unknown`)
- **THEN** DSL validation returns HTTP 422 with validation error code `FLW-E006` (inside `FLOW_VALIDATION_FAILED`) and no workflow is persisted
- **AND** the registry's `resolveActivity` lookup for that name throws a non-retryable failure with error code `UNKNOWN_TASK_TYPE`

### Requirement: Tenant-scoped activity credentials
The system SHALL ensure that every first-party task-type activity executes API calls under a short-lived tenant-scoped `flc_service_…` API key (key type `service`, db role `falcone_service`) minted for the execution run. The system SHALL NOT use static platform credentials or the platform superuser role when invoking any first-party activity. The minted key SHALL be destroyed or expired after the execution run concludes.

#### Scenario: db.query executes under tenant credentials
- **WHEN** a `db.query` activity runs for workspace W of tenant T
- **THEN** the underlying `executePostgresData` call carries `identity.dbRole = "falcone_service"` and `identity.tenantId = T`, so RLS restricts the query to tenant T rows only

#### Scenario: Cross-tenant isolation via RLS
- **WHEN** a `db.query` activity for tenant A attempts to read rows belonging to tenant B (e.g. by specifying tenant B's workspace)
- **THEN** RLS enforced by the `falcone_service` role returns zero rows for tenant B data and does not expose tenant B information to tenant A

### Requirement: db.query activity
The system SHALL provide a `db.query` activity that accepts a Postgres or Mongo data-API operation envelope (database name, schema/collection, operation type, filter/values) and executes it via the existing `executePostgresData` / `executeMongoData` executor path, respecting RLS and the `falcone_service` db role. The activity SHALL propagate `tenantId` and `workspaceId` from the execution context into the executor `identity` parameter.

#### Scenario: Successful Postgres insert
- **WHEN** a `db.query` activity is invoked with `{ engine: "postgres", operation: "insert", databaseName: "d", schemaName: "public", tableName: "items", values: { name: "x" } }` and a valid tenant-scoped credential
- **THEN** the row is inserted with `tenant_id` stamped from the execution context and the activity returns `{ status: "success", result: { ... } }`

#### Scenario: RLS violation returns empty result
- **WHEN** a `db.query` activity attempts to `list` rows in a table where none belong to the executing tenant
- **THEN** the activity returns `{ status: "success", result: { items: [] } }` without error and without leaking other tenants' rows

#### Scenario: Non-retryable schema error
- **WHEN** a `db.query` activity references a table that does not exist
- **THEN** the activity throws a non-retryable Temporal `ApplicationFailure` with error code `SCHEMA_ERROR`

### Requirement: storage.put activity
The system SHALL provide a `storage.put` activity that uploads an object to a workspace-scoped storage bucket via the `uploadStorageObject` route (`PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}`). The activity SHALL carry the tenant-scoped credential in the request and SHALL enforce that the bucket belongs to the executing workspace.

#### Scenario: Successful object upload
- **WHEN** a `storage.put` activity is invoked with `{ bucketId: "b1", objectKey: "uploads/file.txt", body: "<base64>", contentType: "text/plain" }` using a valid tenant-scoped credential
- **THEN** the object is stored and the activity returns `{ status: "success", objectKey: "uploads/file.txt", etag: "..." }`

#### Scenario: Cross-workspace upload rejected
- **WHEN** a `storage.put` activity presents a credential for workspace W1 but specifies a bucket belonging to workspace W2
- **THEN** the platform returns 403 and the activity throws a non-retryable `ApplicationFailure` with error code `FORBIDDEN`

### Requirement: storage.get activity
The system SHALL provide a `storage.get` activity that downloads an object from a workspace-scoped storage bucket via the `downloadStorageObject` route (`GET /v1/storage/buckets/{resourceId}/objects/{objectKey}/download`). The response body SHALL be returned base64-encoded in the activity output envelope.

#### Scenario: Successful object download
- **WHEN** a `storage.get` activity is invoked with `{ bucketId: "b1", objectKey: "uploads/file.txt" }` using a valid tenant-scoped credential
- **THEN** the activity returns `{ status: "success", objectKey: "uploads/file.txt", body: "<base64>", contentType: "text/plain" }`

#### Scenario: Object not found — non-retryable
- **WHEN** a `storage.get` activity references an object key that does not exist
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `OBJECT_NOT_FOUND`

### Requirement: functions.invoke activity
The system SHALL provide a `functions.invoke` activity that invokes a named tenant function via `invokeFunctionAction` (`POST /v1/functions/actions/{resourceId}/invocations`) using the tenant-scoped credential. The activity SHALL carry the workspace-scoped resource ID and SHALL NOT allow cross-workspace invocations.

#### Scenario: Successful function invocation
- **WHEN** a `functions.invoke` activity is invoked with `{ actionId: "fn-abc", params: { "key": "value" } }` using a valid tenant-scoped credential
- **THEN** the function executes and the activity returns `{ status: "success", activationId: "...", result: { ... } }`

#### Scenario: Function execution timeout — retryable
- **WHEN** the invoked function exceeds its execution time limit
- **THEN** the activity throws a retryable `ApplicationFailure` with error code `FUNCTION_TIMEOUT`

#### Scenario: Function not found — non-retryable
- **WHEN** the specified function `actionId` does not exist in the workspace
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `FUNCTION_NOT_FOUND`

### Requirement: events.publish activity
The system SHALL provide an `events.publish` activity that publishes one or more messages to a workspace-scoped logical Kafka topic via `events-executor.mjs::executeFunctions` (operation `publish`). Topic isolation SHALL follow the existing `evt.<workspaceId>.<topic>` physical-topic prefix model so that an activity can only publish to the executing workspace's own topics.

#### Scenario: Successful message publish
- **WHEN** an `events.publish` activity is invoked with `{ topic: "orders", messages: [{ value: "{}" }] }` using a valid tenant-scoped credential
- **THEN** the messages are published to physical topic `evt.<workspaceId>.orders` and the activity returns `{ status: "success", topic: "orders", published: 1 }`

#### Scenario: Empty messages array — non-retryable
- **WHEN** an `events.publish` activity is invoked with an empty `messages` array
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `EMPTY_PUBLISH` before making any Kafka call

### Requirement: http.request activity with SSRF guard
The system SHALL provide an `http.request` activity that makes outbound HTTP/HTTPS requests to caller-supplied URLs. The activity SHALL apply the same SSRF blocklist as `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` — blocking private IPv4/IPv6 ranges (RFC 1918, loopback, link-local 169.254.0.0/16, IPv6 link-local fe80::/10) and cloud metadata endpoints — both at URL resolution time and again after DNS resolution (DNS-rebinding defense). The activity SHALL enforce a configurable timeout (default 10 s, max 30 s) and a response body size cap (default 1 MiB, max 10 MiB). The activity SHALL NOT forward any tenant credential or internal header to the external target by default.

#### Scenario: SSRF blocked — link-local IP
- **WHEN** an `http.request` activity is invoked with `{ url: "https://169.254.169.254/latest/meta-data/", method: "GET" }`
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED` and no outbound HTTP connection is opened

#### Scenario: SSRF blocked — decimal-encoded IP
- **WHEN** an `http.request` activity is invoked with `{ url: "https://2852039166/path", method: "GET" }` (decimal form of 169.254.169.254)
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED`

#### Scenario: SSRF blocked — DNS-rebinding at execution time
- **WHEN** the target hostname resolves to a blocked address at request execution time (after passing static validation)
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `SSRF_BLOCKED` and no data is sent

#### Scenario: Legitimate public URL succeeds
- **WHEN** an `http.request` activity targets a public hostname resolving to a non-blocked address and the server responds 200
- **THEN** the activity returns `{ status: "success", httpStatus: 200, body: "...", headers: { ... } }`

#### Scenario: Response size cap exceeded
- **WHEN** the response body exceeds the configured size cap
- **THEN** the activity aborts the download and throws a non-retryable `ApplicationFailure` with error code `RESPONSE_TOO_LARGE`

#### Scenario: Request timeout — retryable
- **WHEN** the target server does not respond within the configured timeout
- **THEN** the activity throws a retryable `ApplicationFailure` with error code `REQUEST_TIMEOUT`

### Requirement: email.send activity deferred
The system SHALL register an `email.send` activity stub in the task-type registry. Until a platform SMTP capability is provisioned (no SMTP service exists in `services/` or `apps/` as of this change), the stub SHALL return a non-retryable `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE` and message `"email.send is not available: no platform SMTP configuration"`. The stub SHALL NOT silently succeed.

#### Scenario: email.send called with no SMTP config
- **WHEN** an `email.send` activity is invoked on a platform where no SMTP configuration is present
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE`

### Requirement: Payload size limits
The system SHALL enforce a maximum serialized payload size of 2 MiB for every activity input envelope and 2 MiB for every activity output envelope (matching Temporal's recommended blob limit). An input exceeding the limit SHALL be rejected before any platform call with error code `PAYLOAD_TOO_LARGE`. An output exceeding the limit SHALL cause the activity to fail with error code `PAYLOAD_TOO_LARGE`.

#### Scenario: Oversized input rejected
- **WHEN** an activity is invoked with an input envelope whose serialized JSON exceeds 2 MiB
- **THEN** the activity throws a non-retryable `ApplicationFailure` with error code `PAYLOAD_TOO_LARGE` before making any downstream call

#### Scenario: Normal-sized payload accepted
- **WHEN** an activity is invoked with an input envelope within the 2 MiB limit
- **THEN** no payload-size error is raised and the activity proceeds normally

### Requirement: Retryable vs non-retryable error classification
The system SHALL classify all activity failures as either retryable or non-retryable and propagate the classification via Temporal `ApplicationFailure.nonRetryable`. Transient platform errors (network timeouts, 503/429 responses, Kafka broker unavailability) SHALL be classified retryable. Deterministic errors (4xx client errors excluding 429, schema errors, SSRF blocks, missing resources, credential errors, `PAYLOAD_TOO_LARGE`) SHALL be classified non-retryable so the Temporal retry policy does not waste attempts on failures that cannot self-heal.

#### Scenario: Network timeout is retryable
- **WHEN** a `db.query` activity fails because the Postgres connection timed out
- **THEN** the `ApplicationFailure` is marked `nonRetryable: false` and Temporal retries according to the workflow retry policy

#### Scenario: 404 not-found is non-retryable
- **WHEN** a `functions.invoke` activity fails because the function does not exist (404 from platform)
- **THEN** the `ApplicationFailure` is marked `nonRetryable: true` and Temporal does not retry
</content>
</invoke>