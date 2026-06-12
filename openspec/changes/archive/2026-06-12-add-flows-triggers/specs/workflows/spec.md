## ADDED Requirements

### Requirement: Cron trigger — Temporal Schedule creation on publish
The system SHALL, when a flow version is published containing one or more cron triggers, create or update a Temporal Schedule for each cron trigger using the Temporal Schedules API; the schedule ID SHALL be namespaced as `{tenantId}:{workspaceId}:{flowId}` so that the tenant and workspace are structurally encoded and no schedule can be addressed across tenant boundaries; overlap policy and catch-up window SHALL be taken verbatim from the DSL trigger options.

#### Scenario: Publishing a flow version with a cron trigger creates a Temporal Schedule
- **WHEN** a tenant publishes flow version 1 containing a cron trigger with expression `0 * * * *` and overlap policy `skip`
- **THEN** the flow executor creates a Temporal Schedule with ID `{tenantId}:{workspaceId}:{flowId}`, spec `0 * * * *`, overlap policy `skip`, and the schedule fires `DslInterpreterWorkflow` at the next wall-clock hour boundary

#### Scenario: Schedule ID encodes tenant identity and cannot address another tenant's flow
- **WHEN** Tenant A publishes a flow and Tenant B attempts to reference the resulting schedule ID
- **THEN** the schedule ID prefix `{tenantA_id}:{workspaceId}:` is structurally incompatible with Tenant B's tenant namespace and Tenant B's flow executor rejects any cross-tenant schedule reference

---

### Requirement: Cron trigger — Temporal Schedule removal on unpublish
The system SHALL delete the Temporal Schedule associated with a flow trigger when the flow version is unpublished or the flow is deleted; no orphaned schedule SHALL remain after a successful unpublish operation.

#### Scenario: Unpublishing a flow version removes its Temporal Schedule
- **WHEN** a tenant unpublishes flow version 1 that previously had a cron trigger registered
- **THEN** the Temporal Schedule with ID `{tenantId}:{workspaceId}:{flowId}` is deleted and no further executions are scheduled by that cron trigger

#### Scenario: Schedule is removed even when the flow definition is also deleted
- **WHEN** a flow definition and all its versions are deleted
- **THEN** all Temporal Schedules associated with that flow are deleted before the deletion operation is acknowledged

---

### Requirement: Cron trigger — separation from scheduling-engine standalone jobs
The system SHALL NOT create or update scheduling-engine job records (table `scheduled_jobs` managed by `services/scheduling-engine/src/job-model.mjs`) for flow cron triggers; flow cron scheduling SHALL be handled exclusively via Temporal Schedules so that the two subsystems have disjoint execution paths and a single cron expression never fires twice from both systems.

#### Scenario: Publishing a flow with a cron trigger creates no scheduling-engine job
- **WHEN** a flow version containing a cron trigger is published
- **THEN** no row is inserted into the `scheduled_jobs` table and no scheduling-engine management action is invoked

---

### Requirement: Inbound webhook trigger — route and HMAC verification
The system SHALL expose a route `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` for receiving inbound webhook deliveries; before starting a workflow execution the system SHALL verify the HMAC-SHA256 signature in the `x-platform-webhook-signature` request header against the per-trigger secret stored in the `flow_trigger_secrets` table using `verifyIncomingWebhook` (reusing `services/webhook-engine/src/webhook-signing.mjs::verifyIncomingWebhook`); if signature verification fails the system SHALL return HTTP 401 and SHALL NOT start a workflow execution.

#### Scenario: Valid HMAC signature starts a workflow execution
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` carries a valid `x-platform-webhook-signature` header computed over the raw request body using the registered per-trigger secret
- **THEN** the system accepts the request, calls `StartWorkflowExecution` on the flow bound to `triggerId`, and returns HTTP 202

#### Scenario: Invalid HMAC signature is rejected with 401 and no run is started
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` carries an `x-platform-webhook-signature` header whose value does not match the per-trigger secret
- **THEN** the system returns HTTP 401 and does NOT call `StartWorkflowExecution`

#### Scenario: Missing signature header is rejected with 401
- **WHEN** an inbound HTTP POST to `/v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}` has no `x-platform-webhook-signature` header
- **THEN** the system returns HTTP 401 and does NOT call `StartWorkflowExecution`

---

### Requirement: Inbound webhook trigger — per-trigger HMAC secrets with tenant scope
The system SHALL generate a cryptographically random per-trigger HMAC secret on trigger registration using `generateSigningSecret` (32 random bytes, hex-encoded) and store the encrypted secret in a `flow_trigger_secrets` table with non-nullable `tenant_id` and `workspace_id` columns following the pattern established by `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`; a secret belonging to one tenant SHALL NOT be loadable by a query carrying a different tenant's `tenant_id`.

#### Scenario: Per-trigger secret row carries non-nullable tenant columns
- **WHEN** a webhook trigger is registered for Tenant A / Workspace W
- **THEN** the resulting `flow_trigger_secrets` row has `tenant_id` equal to Tenant A's ID and `workspace_id` equal to W's ID and neither column is NULL

#### Scenario: Cross-tenant secret lookup returns no rows
- **WHEN** a query for `flow_trigger_secrets` supplies a `trigger_id` belonging to Tenant A but a `tenant_id` belonging to Tenant B
- **THEN** the query returns zero rows and no secret material is disclosed

---

### Requirement: Inbound webhook trigger — replay deduplication via workflow-ID idempotency keys
The system SHALL derive a Temporal workflow-ID deduplication key from a delivery-ID header (e.g. `x-platform-webhook-id`) supplied by the sender; if a workflow with that derived ID is already running or completed the system SHALL return HTTP 202 without starting a second execution (idempotent delivery).

#### Scenario: Replayed delivery with the same delivery ID does not start a second execution
- **WHEN** an inbound POST with delivery ID `d-abc123` has already triggered a workflow execution
- **AND** the same POST is replayed with the same `x-platform-webhook-id: d-abc123` header
- **THEN** the system returns HTTP 202 and no new `DslInterpreterWorkflow` instance is started

---

### Requirement: Inbound webhook trigger — registered in the gateway allow-list
The system SHALL register the webhook trigger ingestion route in the authoritative gateway allow-list `services/gateway-config/public-route-catalog.json` with `privilege_domain: "data_access"`, consistent with the existing flows execution routes (which the gateway treats as high-frequency event-class data traffic). This follows the established convention for the `flows` family, whose routes live in the gateway-config allow-list rather than the generated `services/internal-contracts/src/public-route-catalog.json` (which is regenerated from the OpenAPI source by `validate:public-api` and does not carry the flows family — see `tests/blackbox/flows-api-route-catalog.test.mjs`).

#### Scenario: Route catalog entry is present in the gateway allow-list with the data-access domain
- **WHEN** the gateway allow-list is inspected for `POST /v1/flows/workspaces/{workspaceId}/triggers/webhooks/{triggerId}`
- **THEN** the entry is present with `privilege_domain` equal to `"data_access"`

---

### Requirement: Platform-event trigger — Kafka and CDC topic subscription
The system SHALL, when a flow version with platform-event triggers is published, register consumer subscriptions matching the tenant's Kafka topics (`evt.{workspaceId}.{topic}` physical naming per `apps/control-plane/src/runtime/events-executor.mjs::physicalTopic`) and/or CDC topics (`{tenantId}.{workspaceId}.pg-changes`, `{tenantId}.{workspaceId}.mongo-changes` per `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic` and `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs::deriveTopic`); for each matching message the system SHALL forward the event payload as workflow input and call `StartWorkflowExecution`.

#### Scenario: Platform event on a subscribed topic starts the bound flow
- **WHEN** Tenant A publishes a flow with a platform-event trigger subscribed to topic `order-placed`
- **AND** a message is produced to the physical topic `evt.{workspaceA_id}.order-placed`
- **THEN** the flow executor calls `StartWorkflowExecution` for the bound flow with the message payload as input and the `triggerType` search attribute set to `platform_event`

#### Scenario: Unsubscribed topic events do not start any flow
- **WHEN** a message is produced to `evt.{workspaceA_id}.some-other-topic` for which no flow trigger subscription exists
- **THEN** no `StartWorkflowExecution` call is made

---

### Requirement: Platform-event trigger — cross-tenant isolation via structural topic namespacing
The system SHALL never start a flow belonging to Tenant A as a result of an event produced to a topic whose physical name begins with a prefix other than `evt.{workspaceA_id}.` or `{tenantA_id}.{workspaceA_id}.`; the structural namespacing of physical topic names (enforced by `physicalTopic` and `deriveTopic`) SHALL be the mechanism preventing cross-tenant event fan-out, with no additional runtime check required beyond consuming only the tenant's own physical topic set.

#### Scenario: Event from Tenant B's topic cannot trigger Tenant A's flow
- **WHEN** a message is produced to `evt.{workspaceB_id}.order-placed` (Tenant B's workspace)
- **AND** Tenant A has a flow subscribed to a trigger named `order-placed`
- **THEN** no flow execution is started for Tenant A because the consumer only subscribes to `evt.{workspaceA_id}.order-placed`

---

### Requirement: Platform-event trigger — at-least-once delivery with idempotent start
The system SHALL deliver platform-event trigger activations at-least-once; duplicate Kafka message deliveries SHALL be handled by using a deterministic workflow-ID deduplication key derived from the Kafka topic, partition, and offset so that replaying the same message offset does not start a second `DslInterpreterWorkflow` execution.

#### Scenario: Kafka message redelivery does not produce a duplicate workflow execution
- **WHEN** the flow executor consumer processes the same Kafka message offset twice due to a consumer group rebalance or crash recovery
- **THEN** only one `DslInterpreterWorkflow` execution is started; the second attempt with the same deduplication key is treated as a no-op by Temporal's workflow-ID uniqueness enforcement

---

### Requirement: Version swap on publish — atomic trigger replacement
The system SHALL, when publishing flow version N+1 over version N, atomically delete the trigger registrations for version N and create trigger registrations for version N+1 within the same logical transaction or Temporal Schedule update operation; in-flight version N workflow executions SHALL continue to completion on version N semantics and SHALL NOT be cancelled by the version swap.

#### Scenario: Publishing v2 replaces v1 triggers without stopping in-flight v1 runs
- **WHEN** a flow has version 1 with a cron trigger currently running an execution
- **AND** the tenant publishes version 2 with a modified cron trigger
- **THEN** the Temporal Schedule is updated to fire version 2 for future runs and the in-flight version 1 execution reaches completion without cancellation

#### Scenario: New triggers fire against the new version immediately after publish
- **WHEN** version 2 is published and the cron schedule fires
- **THEN** the new execution runs version 2 of the flow definition, not version 1

---

### Requirement: triggerType search attribute on every trigger-initiated start
The system SHALL stamp a `triggerType` search attribute on every `StartWorkflowExecution` call initiated by a trigger; valid values are `cron`, `webhook`, `platform_event`, and `manual`; the attribute SHALL be visible via Temporal visibility queries and is the normative contract for the monitoring sibling (#366).

#### Scenario: Cron-triggered execution carries triggerType = cron
- **WHEN** a Temporal Schedule fires and starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "cron"`

#### Scenario: Webhook-triggered execution carries triggerType = webhook
- **WHEN** an inbound POST to the webhook trigger route with a valid HMAC starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "webhook"`

#### Scenario: Platform-event-triggered execution carries triggerType = platform_event
- **WHEN** a Kafka platform-event consumer match starts a `DslInterpreterWorkflow` execution
- **THEN** the execution's search attributes include `triggerType: "platform_event"`
