# webhooks Specification

## Purpose
TBD - created by archiving change fix-webhook-delivery-ssrf-repin. Update Purpose after archive.
## Requirements
### Requirement: Webhook delivery client MUST re-resolve the target hostname and block delivery if any resolved IP is in a blocked range

The system SHALL, immediately before opening a connection to the webhook target URL, perform a fresh DNS resolution of the target hostname and call `isBlockedIp` on every resolved address; if any resolved address is blocked, the system SHALL abort the delivery attempt, record the outcome as `permanently_failed` with an `error_detail` indicating SSRF guard rejection, and SHALL NOT open the network connection.

#### Scenario: Delivery is rejected when target hostname re-resolves to a private IP at send time (bbx-webhook-rebind)

- **WHEN** a webhook subscription was registered with a hostname that resolved to a public IP at subscription time (passing validation), and at delivery time that hostname resolves to a blocked IP address (e.g. `169.254.169.254`, `127.0.0.1`, or any RFC1918 address)
- **THEN** the delivery worker refuses to open the HTTP connection, records the delivery attempt as `permanently_failed`, and does not emit the webhook payload to the private IP

#### Scenario: Delivery succeeds when hostname re-resolves to the same public IP

- **WHEN** a webhook subscription was registered with a hostname that resolved to a public IP at subscription time, and at delivery time that hostname continues to resolve to a public (non-blocked) IP
- **THEN** the delivery proceeds normally and the attempt outcome reflects the HTTP response from the target server

### Requirement: Webhook delivery client MUST connect to the pinned validated IP address

The system SHALL connect the HTTP client to the specific IP address that was resolved and validated at delivery time (IP pinning), bypassing any further OS-level DNS resolution for that connection, to prevent TOCTOU races between the re-validation step and the actual connect.

#### Scenario: HTTP client connects to the validated IP, not via a second DNS lookup

- **WHEN** the delivery worker has resolved and validated the target hostname to a specific non-blocked IP address
- **THEN** the HTTP connection is established directly to that IP address (e.g. via a custom `lookup` function or pre-resolved agent) such that no second OS DNS resolution can yield a different address

### Requirement: Webhook delivery client MUST refuse HTTP redirects that resolve to a blocked IP

The system SHALL disable automatic HTTP redirect following OR validate every redirect `Location` header by re-resolving its hostname and calling `isBlockedIp`; if the redirect target resolves to a blocked IP the delivery SHALL be aborted as `permanently_failed`.

#### Scenario: Redirect to a private IP is refused

- **WHEN** the webhook target server responds with an HTTP 3xx redirect whose `Location` header contains a hostname that resolves to a blocked IP (e.g. `169.254.169.254`)
- **THEN** the delivery worker does not follow the redirect, records the attempt as `permanently_failed`, and logs the SSRF guard rejection

### Requirement: Signing secrets carry tenant and workspace identity

The system SHALL store `tenant_id` and `workspace_id` on every `webhook_signing_secrets`
row, back-filled from the parent `webhook_subscriptions` record, so that the tenant
dimension of a secret is structurally present and indexable.

#### Scenario: New signing secret inherits tenant identity from subscription

- **WHEN** a new webhook subscription is created for Tenant A / Workspace W and an
  initial signing secret is generated
- **THEN** the resulting `webhook_signing_secrets` row has `tenant_id` equal to
  Tenant A's ID and `workspace_id` equal to W's ID

#### Scenario: Back-fill populates tenant columns on existing rows

- **WHEN** the migration is applied to a database with pre-existing
  `webhook_signing_secrets` rows
- **THEN** every pre-existing row has `tenant_id` and `workspace_id` populated from
  the corresponding `webhook_subscriptions` parent row and no row has a NULL value
  in either column

### Requirement: Signing-secret reads always carry a tenant predicate

The system SHALL pass the owning subscription's `tenant_id` and `workspace_id`
into every signing-secret db call (`insertSecret`, `rotateSecret`, `listSecrets`)
so that the data-access layer can include a `(tenant_id, workspace_id)` predicate
on every query that reads from `webhook_signing_secrets`, and a `subscription_id`
alone is never sufficient to retrieve secret material across tenant boundaries.

> Note (partial scope): the `AND tenant_id = $N AND workspace_id = $M` SQL
> predicate is applied inside the injected `db` access object, whose SQL is
> deployed out of this source tree. The in-source contract delivered here is that
> the action layer always supplies the `tenant_id`/`workspace_id` arguments the
> predicate consumes; black-box tests assert those arguments are passed and that
> a db which honours them returns no secret for a mismatched tenant.

#### Scenario: Secret read with correct tenant predicate succeeds

- **WHEN** the webhook engine resolves signing secrets for a delivery belonging to
  Tenant A / Workspace W using `subscription_id` and the correct
  `(tenant_id, workspace_id)` pair
- **THEN** the query returns the active secret records for that subscription

#### Scenario: Secret read with mismatched tenant predicate returns no rows

- **WHEN** a query for `webhook_signing_secrets` supplies a `subscription_id`
  that belongs to Tenant A but a `tenant_id` belonging to Tenant B
- **THEN** the query returns zero rows and no secret material is disclosed to
  the caller associated with Tenant B

### Requirement: Cross-tenant secret retrieval is structurally impossible

The system SHALL ensure that no in-source code path in the webhook engine omits
the tenant dimension when reading or rotating signing secrets, so that — combined
with the data-access layer's `(tenant_id, workspace_id)` predicate — signing
secrets belonging to one tenant cannot be retrieved on behalf of a different
tenant, even in the presence of a known or guessed `subscription_id`. The system
SHALL additionally reject, at write time, any attempt to persist a signing secret
whose subscription/record lacks a non-empty `tenant_id` (or whose supplied secret
`tenant_id` does not match the subscription's).

#### Scenario: Secret write without a tenant identity is rejected

- **WHEN** a signing-secret creation is attempted for a subscription/record that
  carries no (empty) `tenant_id`
- **THEN** the secret is not persisted (no `insertSecret` call) and the request
  is rejected with a tenant-scope error

#### Scenario: Delivery signing uses tenant-scoped secret lookup

- **WHEN** the webhook delivery processor signs an outbound payload for
  Tenant A's subscription
- **THEN** the HMAC is computed using secrets whose `tenant_id = Tenant A` and
  no secret belonging to Tenant B is ever loaded into the signing context

#### Scenario: Secret rotation is scoped to the owning tenant

- **WHEN** a tenant admin for Tenant A rotates the signing secret for a
  subscription they own
- **THEN** only rows where `tenant_id = Tenant A` are affected and no row
  belonging to Tenant B is modified or invalidated

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

