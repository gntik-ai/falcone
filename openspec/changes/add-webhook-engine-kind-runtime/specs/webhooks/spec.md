# webhooks — spec delta for add-webhook-engine-kind-runtime

## ADDED Requirements

### Requirement: Webhook management plane is served through the gateway on the kind runtime

The system SHALL route all requests to `/v1/webhooks/*` through the API gateway to the kind control-plane, and the control-plane SHALL dispatch those requests to the webhook management handler, so that the full management/subscription surface is reachable and does not return a gateway 404 or a `NO_ROUTE` error.

#### Scenario: Event-type catalogue is returned

- **WHEN** an authenticated caller sends `GET /v1/webhooks/event-types`
- **THEN** the response is `200` with a JSON body containing an `eventTypes` array listing the supported platform event types

#### Scenario: Subscription is created with valid parameters

- **WHEN** an authenticated caller sends `POST /v1/webhooks/subscriptions` with a valid HTTPS target URL and at least one known event type
- **THEN** the response is `201` with a JSON body containing `subscriptionId`, `targetUrl`, `eventTypes`, `status`, and `signingSecret`; the subscription is persisted under the caller's tenant and workspace

#### Scenario: Creating a subscription past the per-workspace quota returns 409

- **WHEN** an authenticated caller has already reached the `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` limit for their workspace and sends `POST /v1/webhooks/subscriptions`
- **THEN** the response is `409` with error code `QUOTA_EXCEEDED` and no new subscription is persisted

#### Scenario: Subscription lifecycle — pause, resume, rotate-secret, delete

- **WHEN** an authenticated caller sequentially sends `POST /v1/webhooks/subscriptions/{id}/pause`, then `POST /v1/webhooks/subscriptions/{id}/resume`, then `POST /v1/webhooks/subscriptions/{id}/rotate-secret`, then `DELETE /v1/webhooks/subscriptions/{id}`
- **THEN** each operation returns the expected status code and the subscription state transitions correctly: `paused`, `active`, a new `signingSecret`, and finally `404` on a subsequent `GET`

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
