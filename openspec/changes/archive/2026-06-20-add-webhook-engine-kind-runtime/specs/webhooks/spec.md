# webhooks — spec delta for add-webhook-engine-kind-runtime

## ADDED Requirements

### Requirement: Webhook management plane is served through the gateway on the kind runtime

The system SHALL route webhook management requests through the API gateway to the kind control-plane, and the control-plane SHALL dispatch them to the webhook management handler, so that the full management/subscription surface is reachable and does not return a gateway 404 or a `NO_ROUTE` error. The surface SHALL be served in two addressing forms: the workspace-addressed form `/v1/workspaces/{workspaceId}/webhooks/...` (primary; the workspace comes from the path) and the tenant-addressed form `/v1/webhooks/...` (the workspace comes from the caller's token).

#### Scenario: Event-type catalogue is returned

- **WHEN** an authenticated caller sends `GET /v1/workspaces/{workspaceId}/webhooks/event-types` (or `GET /v1/webhooks/event-types`)
- **THEN** the response is `200` with a JSON body containing an `eventTypes` array listing the supported platform event types

#### Scenario: Subscription is created with valid parameters

- **WHEN** a tenant owner sends `POST /v1/workspaces/{workspaceId}/webhooks/subscriptions` for a workspace in their tenant, with a valid HTTPS target URL and at least one known event type
- **THEN** the response is `201` with a JSON body containing `subscriptionId`, `targetUrl`, `eventTypes`, `status`, and `signingSecret`; the subscription is persisted under the caller's tenant and the path workspace

#### Scenario: Creating a subscription past the per-workspace quota returns 409

- **WHEN** a caller has already reached the `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` limit for the workspace and sends another `POST .../webhooks/subscriptions`
- **THEN** the response is `409` with error code `QUOTA_EXCEEDED` and no new subscription is persisted

#### Scenario: Subscription lifecycle — pause, resume, rotate-secret, delete

- **WHEN** a caller sequentially sends `POST .../webhooks/subscriptions/{id}/pause`, then `.../resume`, then `.../rotate-secret`, then `DELETE .../webhooks/subscriptions/{id}`
- **THEN** each operation returns the expected status code and the subscription state transitions correctly: `paused`, `active`, a new `signingSecret`, and finally `404` on a subsequent `GET`

### Requirement: Webhook subscriptions are workspace-addressed and authorized against the caller's tenant

The system SHALL accept webhook subscription management under `/v1/workspaces/{workspaceId}/webhooks/...`, taking the target workspace from the path and the tenant from the verified token, and SHALL authorize that the path workspace belongs to the caller's tenant before serving the request. A workspace that does not exist OR belongs to a different tenant SHALL be reported as `404` (no existence disclosure). This makes the management plane usable by a tenant owner whose token carries no `workspace_id`.

#### Scenario: Tenant owner manages a workspace they own

- **WHEN** a tenant owner sends a webhook request to `/v1/workspaces/{workspaceId}/webhooks/...` for a workspace in their own tenant
- **THEN** the request is authorized and served, scoped to that workspace

#### Scenario: Cross-tenant workspace path is rejected as 404

- **WHEN** a caller sends a webhook request to `/v1/workspaces/{workspaceId}/webhooks/...` where `{workspaceId}` belongs to a different tenant
- **THEN** the response is `404`, no subscription is created or disclosed, and no data crosses the tenant boundary

### Requirement: Webhook management is tenant and workspace isolated on the kind runtime

The system SHALL enforce that every webhook management operation on the kind runtime returns only data belonging to the authenticated caller's tenant and workspace; a subscription belonging to one tenant SHALL be invisible and inaccessible to a different tenant, regardless of whether the subscription ID is known.

#### Scenario: Subscription list is scoped to the caller's tenant and workspace

- **WHEN** Tenant A creates a subscription and Tenant B calls `GET /v1/webhooks/subscriptions`
- **THEN** the response for Tenant B contains no subscription belonging to Tenant A

#### Scenario: Cross-tenant access to a subscription by ID returns 404

- **WHEN** Tenant B sends `GET /v1/webhooks/subscriptions/{id}` where `{id}` belongs to a subscription owned by Tenant A
- **THEN** the response is `404` and no data from Tenant A's subscription is disclosed

#### Scenario: Cross-tenant PATCH or DELETE of a subscription returns 404

- **WHEN** Tenant B sends `PATCH /v1/webhooks/subscriptions/{id}` or `DELETE /v1/webhooks/subscriptions/{id}` where `{id}` belongs to a subscription owned by Tenant A
- **THEN** the response is `404` and Tenant A's subscription is not modified or deleted

### Requirement: Webhook subscription storage is provisioned idempotently on the kind runtime database

The system SHALL apply the webhook schema (tables `webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts` plus the `tenant_id`/`workspace_id` columns on `webhook_signing_secrets`) at control-plane startup using idempotent DDL, so that the relations exist after a cold start and repeated restarts do not produce errors.

#### Scenario: Schema exists after a cold control-plane start

- **WHEN** the kind control-plane starts against a database with no pre-existing webhook tables
- **THEN** all four webhook relations (`webhook_subscriptions`, `webhook_signing_secrets`, `webhook_deliveries`, `webhook_delivery_attempts`) exist and the `tenant_id`/`workspace_id` columns are present on `webhook_signing_secrets`

#### Scenario: Repeated control-plane restarts are a no-op

- **WHEN** the control-plane is restarted against a database that already has the webhook schema applied
- **THEN** startup completes without error and the schema is unchanged
