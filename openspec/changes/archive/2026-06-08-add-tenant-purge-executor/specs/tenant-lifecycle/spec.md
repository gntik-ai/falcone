# Tenant Lifecycle

## ADDED Requirements

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
