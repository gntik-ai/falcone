# tenant-lifecycle Specification

## Purpose
TBD - created by archiving change add-tenant-purge-executor. Update Purpose after archive.
## Requirements
### Requirement: Retention-window-driven automatic purge sweep

The system SHALL automatically identify tenants in `state='deleted'` whose
`retentionPolicy.purgeEligibleAt` has elapsed and execute a cascading purge saga
across all six provisioned domains (IAM, Kafka, Postgres, Mongo, storage,
functions) without requiring manual operator intervention.

#### Scenario: Eligible deleted tenant is purged automatically

- **WHEN** a tenant's `state` is `deleted` and the current time is past
  `retentionPolicy.purgeEligibleAt` and the tenant has a valid export checkpoint
- **THEN** the purge sweep action initiates the deletion saga, removes all
  provisioned resources across IAM, Kafka, Postgres, Mongo, storage, and
  functions domains, hard-deletes all service-owned rows, and transitions the
  tenant to `state='purged'`

#### Scenario: Tenant inside the retention window is not purged

- **WHEN** a tenant's `state` is `deleted` and the current time is before
  `retentionPolicy.purgeEligibleAt`
- **THEN** the purge sweep action skips that tenant and no resources are removed

### Requirement: Dual-confirmation and elevated-access enforcement

The system SHALL refuse to execute a tenant purge unless both elevated access and
a second confirmation are present, as evaluated by `evaluateTenantLifecycleMutation`,
to prevent accidental or unauthorised irreversible deletion.

#### Scenario: Purge blocked without elevated access

- **WHEN** the purge sweep or on-demand endpoint is invoked without elevated
  access (`hasElevatedAccess=false`)
- **THEN** the purge is rejected with a `blocker: 'purge requires elevated access and reinforced confirmation'` response and no resources are deleted

#### Scenario: Purge blocked without export checkpoint

- **WHEN** a tenant in `state='deleted'` has no `exportProfile.lastConsistencyCheckpoint`
- **THEN** the purge sweep skips that tenant and logs a blocker indicating the
  missing export checkpoint

### Requirement: Six-domain cascading teardown

The system SHALL remove all provisioned resources across all six domains — IAM
realm, Kafka topics and ACLs, Postgres schema, Mongo database, storage namespace,
and functions namespace — as part of the purge saga, leaving no orphaned
cross-tenant data in any domain.

#### Scenario: All six domains are cleaned up on purge

- **WHEN** a tenant purge saga completes successfully
- **THEN** the IAM realm, Kafka topics/ACLs, Postgres schema, Mongo database,
  storage namespace, and functions namespace previously belonging to that tenant
  no longer exist, and no service-owned database rows referencing the purged
  `tenantId` remain

#### Scenario: Partial failure does not leave inconsistent state

- **WHEN** one domain teardown step fails during the purge saga
- **THEN** the saga records the partial failure in the async-operation log, does
  not transition the tenant to `state='purged'`, and allows a retry to resume
  from the failed step

### Requirement: tenant.purged audit event with destruction manifest

The system SHALL emit a dedicated free-form `tenant.purged` audit event upon
successful completion of a purge saga, including a verifiable destruction
manifest that enumerates all resources removed (domain, resource type, resource
identifier) and the actor who authorised the purge. The manifest SHALL live on
the dedicated `tenant.purged` payload (not inside the
`async_operation.state_changed` schema, whose `additionalProperties:false` and
`eventType` const cannot carry a manifest); any standard async-operation
lifecycle event emitted alongside is supplementary.

#### Scenario: Successful purge emits tenant.purged event

- **WHEN** a tenant purge saga completes successfully across all six domains
- **THEN** a dedicated `tenant.purged` event payload is emitted (via the injected
  event publisher) containing the `eventType: 'tenant.purged'`, the `tenantId`,
  the list of `destroyedResources` (each with `domain`, `resourceType`,
  `resourceId`, `status`), the `actorUserId`, the `approvalTicket`, and an
  `occurredAt` timestamp

#### Scenario: Partial-failure purge does not emit tenant.purged

- **WHEN** the purge saga fails on one or more domain teardown steps
- **THEN** no `tenant.purged` event is emitted; instead a `purge.failed` or
  equivalent error event is emitted with the partial destruction inventory

### Requirement: On-demand operator-triggered purge endpoint

The system SHALL wire the existing public route `purgeTenant`
(`POST /v1/tenants/{tenantId}/purge`, resourceType `tenant_purge`, tenant-scoped,
tenantBinding required) to a handler that allows an authorised operator to
trigger an immediate purge of a `state='deleted'` tenant, subject to the same
dual-confirmation and export-checkpoint guards as the automated sweep. (The
route already exists in the public route catalog; this change does NOT introduce
a new `/v1/admin/...` path.)

#### Scenario: On-demand purge accepted with valid dual-confirmation

- **WHEN** an operator calls `POST /v1/tenants/{tenantId}/purge` with
  elevated access, a valid `approvalTicket`, and the correct `confirmationText`
  for a tenant in `state='deleted'` past its retention window
- **THEN** the purge saga is initiated, the handler returns a 202 Accepted with
  an async-operation reference, and the tenant transitions to `state='purged'`
  upon saga completion

#### Scenario: On-demand purge rejected for non-deleted tenant

- **WHEN** an operator calls `POST /v1/tenants/{tenantId}/purge` for a
  tenant whose `state` is not `deleted`
- **THEN** the handler returns 409 Conflict with a `blocker` message and no
  resources are removed

### Requirement: Tenant deletion and purge MUST be available

The system SHALL expose `DELETE /v1/tenants/{t}` and `POST /v1/tenants/{t}/purge` so an operator can offboard a tenant, rather than returning `404 NO_ROUTE`.

#### Scenario: Purge route is reachable

- **WHEN** an authorized operator calls `POST /v1/tenants/{t}/purge` for an existing tenant
- **THEN** the system accepts the request and begins removing the tenant (not `404 NO_ROUTE`)

### Requirement: Tenant purge MUST cascade to all owned resources

The system SHALL, on tenant purge, remove every resource the tenant owns — workspaces, databases, realms, buckets, topics, keys, registry rows, and async-op rows — leaving no orphaned data.

#### Scenario: No orphans remain after purge

- **WHEN** a tenant with a workspace, database, realm, bucket, and topic is purged
- **THEN** none of those resources and no `workspace_databases`/`async_operations` rows for that tenant remain

### Requirement: Control-plane schema migrations retry on transient DB unavailability

The system SHALL retry the boot schema migration with exponential backoff when the
initial connection attempt fails with `ECONNREFUSED` or equivalent transient errors,
continuing until the migration succeeds or a configured maximum retry duration
(default 5 minutes) is exceeded.

#### Scenario: Control-plane started before Postgres converges to schema-ready

- **WHEN** the control-plane starts and PostgreSQL is not yet accepting connections
- **THEN** the control-plane MUST retry the migration at increasing intervals, log
  each attempt, and eventually succeed once Postgres becomes available — without
  requiring a pod restart

#### Scenario: Max retry duration exceeded — control-plane exits with error

- **WHEN** PostgreSQL is unavailable for longer than the configured maximum retry
  duration
- **THEN** the control-plane MUST exit with a non-zero code and a clear error log
  indicating the migration timed out, so that Kubernetes restarts the pod

#### Scenario: Successful migration after retry — tenant ops succeed

- **WHEN** the migration succeeds after one or more retries
- **THEN** subsequent calls to `POST /v1/tenants` MUST return 201 and the `tenants`
  table MUST be present in the database

### Requirement: Plan catalog listing returns 200 for superadmin

The control-plane runtime SHALL provision the plan catalog schema (the `plans` relation
and its companion plan tables) so that `GET /v1/plans` responds with **HTTP 200** and a
paginated catalog envelope when called by an authenticated superadmin, and MUST NOT
return a 500 `relation "plans" does not exist` error.

#### Scenario: Superadmin retrieves plan catalog

- **WHEN** a superadmin calls `GET /v1/plans`
- **THEN** the response MUST be **200** with a JSON body containing the `plans` array
  (possibly empty on a fresh platform) plus `total`, `page`, and `pageSize`, and MUST
  NOT be a 500 error

#### Scenario: Non-superadmin is forbidden

- **WHEN** a caller that is not a superadmin calls `GET /v1/plans`
- **THEN** the response MUST be **403**

### Requirement: Tenant quota metrics endpoint returns 200

The control-plane runtime SHALL provision the quota catalog/override schema
(`quota_dimension_catalog`, `quota_overrides`, `plans.quota_type_config`) so that the
tenant-effective-entitlements query resolves, and the console metrics quota handler SHALL
degrade to an empty (healthy) posture on any underlying error so that
`GET /v1/metrics/tenants/{id}/quotas` responds with **HTTP 200** for an authorized caller
and MUST NOT return a 500 caused by a missing relation (42P01) or a forbidden inner lookup.

#### Scenario: Authorized caller retrieves tenant quota metrics

- **WHEN** a superadmin or the tenant's authorized user calls `GET /v1/metrics/tenants/{id}/quotas`
- **THEN** the response MUST be **200** with a quota posture body (dimensions + breaches), and
  MUST NOT be a 500 error caused by a missing relation or a forbidden inner lookup

#### Scenario: Quota source unavailable degrades to a healthy posture

- **WHEN** the entitlements limits source errors (missing relation, or the inner action forbids the
  authorized caller's role)
- **THEN** the endpoint MUST still return **200** with an empty dimension set and no hard-limit
  breaches, rather than a 500

