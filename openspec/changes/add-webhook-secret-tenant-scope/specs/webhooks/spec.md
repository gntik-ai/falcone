# Webhooks

## ADDED Requirements

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

The system SHALL include a `(tenant_id, workspace_id)` predicate on every query
that reads from `webhook_signing_secrets`, so that a subscription_id alone is
never sufficient to retrieve secret material across tenant boundaries.

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

The system SHALL ensure that no code path in the webhook engine can retrieve
signing secrets belonging to one tenant on behalf of a different tenant, even
in the presence of a known or guessed `subscription_id`.

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
