# Feature Specification: Realtime Channel & Subscription Model per Workspace

**Feature Branch**: `079-realtime-channel-subscriptions`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Diseñar el modelo de channels/subscriptions por workspace y tipo de evento"  
**Traceability**: EP-17 / US-DX-01 / US-DX-01-T01

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer subscribes to a workspace channel (Priority: P1)

A developer building an external application needs to receive real-time notifications when data changes occur inside a specific workspace. They browse the available channel types for their workspace, select the event types they care about (e.g., document changes in a collection, row updates in a table), and create a subscription. From that moment, any qualifying event in the workspace is routed to their subscription endpoint or live connection.

**Why this priority**: This is the fundamental value proposition — without a subscription model, no realtime data flow is possible.

**Independent Test**: Can be tested by creating a workspace, listing available channel types, creating a subscription for a specific event type, and verifying the subscription is persisted and retrievable.

**Acceptance Scenarios**:

1. **Given** a workspace with at least one data source (PostgreSQL table or MongoDB collection), **When** a developer requests the list of available channel types for that workspace, **Then** the system returns all channel types supported for that workspace's provisioned data sources.
2. **Given** a valid workspace and a supported channel type, **When** the developer creates a subscription specifying the channel type and an optional event filter, **Then** the system persists the subscription, associates it with the requesting identity, and returns a unique subscription identifier.
3. **Given** a subscription already exists, **When** the developer retrieves it by identifier, **Then** the system returns the subscription's full configuration including channel type, event filter, status, and creation metadata.

---

### User Story 2 — Workspace admin manages subscriptions (Priority: P1)

A workspace administrator needs visibility into all active subscriptions within their workspace to govern resource usage, enforce policies, and revoke subscriptions that violate workspace rules or exceed quotas.

**Why this priority**: Governance and visibility are essential for multi-tenant safety; admins must control what leaves the workspace boundary.

**Independent Test**: Can be tested by creating several subscriptions under a workspace, then listing, inspecting, suspending, and deleting them as an admin.

**Acceptance Scenarios**:

1. **Given** a workspace with multiple subscriptions from different developers, **When** a workspace admin lists all subscriptions, **Then** the system returns every subscription in that workspace with owner, channel type, status, and creation date.
2. **Given** an active subscription, **When** a workspace admin suspends it, **Then** the subscription status changes to `suspended` and no further events are delivered to it.
3. **Given** a suspended subscription, **When** a workspace admin reactivates it, **Then** the subscription status changes to `active` and event delivery resumes.
4. **Given** any subscription, **When** a workspace admin deletes it, **Then** the subscription is permanently removed and its identifier cannot be reused.

---

### User Story 3 — Tenant owner reviews cross-workspace subscription activity (Priority: P2)

A tenant owner wants to understand subscription usage across all workspaces under their tenant to plan capacity, detect anomalies, and ensure compliance with tenant-level quotas.

**Why this priority**: Provides tenant-wide observability which is important but not blocking for the core subscription flow.

**Independent Test**: Can be tested by creating subscriptions across multiple workspaces under one tenant and querying aggregate subscription counts and statuses at the tenant level.

**Acceptance Scenarios**:

1. **Given** a tenant with multiple workspaces, each containing subscriptions, **When** the tenant owner queries subscription summary by workspace, **Then** the system returns per-workspace subscription counts grouped by status and channel type.
2. **Given** a tenant-level subscription quota is defined, **When** a new subscription creation would exceed the quota, **Then** the system rejects the creation with a clear quota-exceeded message.

---

### User Story 4 — System routes events to matching subscriptions (Priority: P1)

When a data change event occurs inside a workspace (e.g., a row is inserted, a document is updated), the platform must resolve which active subscriptions match that event based on channel type and any configured event filters, so that downstream delivery mechanisms know exactly where to send notifications.

**Why this priority**: The matching/routing model is the core engine that connects events to subscribers; without it, subscriptions have no effect.

**Independent Test**: Can be tested by creating subscriptions with various channel types and filters, then simulating an incoming event and verifying the correct set of subscriptions is resolved.

**Acceptance Scenarios**:

1. **Given** three active subscriptions in a workspace — one for all PostgreSQL changes, one for MongoDB changes on collection "orders", and one suspended — **When** a PostgreSQL row-insert event arrives, **Then** only the first subscription is resolved as a match.
2. **Given** a subscription with a filter on a specific collection or table, **When** an event from a different collection/table arrives, **Then** the subscription is NOT matched.
3. **Given** a subscription in `suspended` status, **When** a matching event arrives, **Then** the subscription is excluded from resolution.

---

### Edge Cases

- What happens when a developer tries to create a subscription for a channel type not provisioned in their workspace? → The system rejects with a clear error indicating the channel type is unavailable.
- What happens when a workspace has zero provisioned data sources? → The system returns an empty list of available channel types; subscription creation is not possible.
- What happens when the same developer creates duplicate subscriptions with identical channel type and filter? → The system allows it (subscriptions are independent resources with unique identifiers); deduplication is the developer's responsibility.
- What happens when a subscription is created but the workspace is subsequently deprovisioned? → Subscriptions tied to the workspace become orphaned and must be cleaned up; they must not route events to a non-existent workspace.
- What happens when a developer exceeds their per-workspace or per-tenant subscription limit? → Creation is rejected with a quota-exceeded error referencing the applicable limit.
- What happens when an event matches hundreds of subscriptions in the same workspace? → The system must resolve all matches without dropping any; fan-out capacity is a function of configured limits.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define a **channel** as a named, typed conduit scoped to a workspace, representing a category of events (e.g., "postgresql-changes", "mongodb-changes") derived from the workspace's provisioned data sources.
- **FR-002**: The system MUST define a **subscription** as a resource owned by an authenticated identity, bound to exactly one channel within one workspace, optionally narrowed by an event filter (e.g., specific table, collection, or operation type).
- **FR-003**: Each subscription MUST have a unique, opaque identifier that is globally unique within the tenant.
- **FR-004**: Subscriptions MUST track at minimum: identifier, owning identity, workspace reference, channel type, optional event filter, status (active | suspended | deleted), creation timestamp, and last-modified timestamp.
- **FR-005**: The system MUST support creating, retrieving, listing, updating (filter/status), and deleting subscriptions via a workspace-scoped API surface.
- **FR-006**: The system MUST allow listing available channel types for a given workspace based on its currently provisioned data sources.
- **FR-007**: The system MUST enforce workspace-scoped isolation: a subscription in workspace A MUST NEVER receive events from workspace B, even within the same tenant.
- **FR-008**: The system MUST enforce tenant-scoped isolation: no subscription or channel metadata from tenant X may be visible or accessible from tenant Y.
- **FR-009**: The system MUST support subscription-level status transitions: `active → suspended`, `suspended → active`, and `any → deleted`. The `deleted` state is terminal.
- **FR-010**: The system MUST support resolving the set of active, matching subscriptions for a given incoming event (by workspace, channel type, and event filter criteria) to enable downstream delivery.
- **FR-011**: The system MUST enforce configurable quotas on the number of subscriptions per workspace and per tenant. Quota violations MUST be rejected at creation time with a descriptive error.
- **FR-012**: The system MUST record an auditable event for every subscription lifecycle change (create, update status, delete) including actor identity, timestamp, and before/after state.
- **FR-013**: The system MUST validate that the requested channel type is available in the target workspace before allowing subscription creation.
- **FR-014**: The system MUST support pagination when listing subscriptions (workspace-scoped and tenant-scoped summary views).

### Key Entities

- **Channel Type**: Represents a category of realtime events available within a workspace. Derived from provisioned data sources. Attributes: name/identifier, description, associated data-source kind (PostgreSQL, MongoDB), workspace reference, availability status.
- **Subscription**: A durable resource binding an authenticated consumer to a specific channel type within a workspace. Attributes: unique ID, owner identity, workspace ID, tenant ID, channel type reference, event filter (optional structured criteria), status, creation timestamp, last-modified timestamp.
- **Event Filter**: An optional, structured narrowing criterion on a subscription that limits which events within a channel type are relevant (e.g., specific table name, collection name, operation types like INSERT/UPDATE/DELETE).
- **Subscription Quota**: A configurable limit on subscription count, enforceable at workspace level and tenant level.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can create a subscription to a workspace channel in under 5 seconds from the moment they know the channel type.
- **SC-002**: A workspace admin can list all subscriptions in their workspace and see complete metadata within 3 seconds, for workspaces with up to 500 active subscriptions.
- **SC-003**: The subscription resolution (matching incoming events to active subscriptions) returns the correct set of matching subscriptions with 100% accuracy — no false positives and no missed matches.
- **SC-004**: Subscriptions enforce workspace and tenant isolation with zero cross-boundary leakage under concurrent multi-tenant load.
- **SC-005**: Every subscription lifecycle operation (create, suspend, reactivate, delete) produces an auditable record that is queryable within 30 seconds of the operation.
- **SC-006**: Quota enforcement rejects subscription creation attempts beyond configured limits 100% of the time, with no race-condition-induced over-allocation.

## Scope Boundaries

### In Scope

- Channel type model and its derivation from provisioned workspace data sources.
- Subscription CRUD lifecycle with status management.
- Event filter model (structure and matching semantics).
- Subscription resolution logic (mapping events → matching subscriptions).
- Multi-tenant and workspace isolation rules for channels and subscriptions.
- Quota definition and enforcement model.
- Audit event contract for subscription lifecycle changes.

### Out of Scope

- Actual delivery transport (WebSocket, SSE, webhook HTTP calls) — handled by subsequent tasks.
- PostgreSQL CDC (Change Data Capture) connector — US-DX-01-T02.
- MongoDB change stream connector — US-DX-01-T03.
- Authentication, authorization scopes, and per-field filtering on events — US-DX-01-T04.
- SDK examples or client-side subscription code — US-DX-01-T05.
- End-to-end integration and reconnection tests — US-DX-01-T06.

## Assumptions

- Each workspace has a known set of provisioned data sources (PostgreSQL databases/tables, MongoDB databases/collections) that can be introspected to derive available channel types.
- The identity system (Keycloak) already provides authenticated user context including tenant and workspace membership.
- Subscription persistence will coexist with existing platform data stores; the choice of store is an implementation decision deferred to planning.
- Quota values are configured at the platform/tenant administration level and are available for enforcement at subscription creation time.
- The event filter model must be extensible to support future event source types beyond PostgreSQL and MongoDB without breaking existing subscriptions.

## Dependencies

- **US-EVT-03**: Event backbone and topic conventions — provides the Kafka topic structure that channel types map onto.
- **US-GW-04**: API Gateway routing — provides the API surface through which subscription CRUD operations are exposed.
- **US-PGDATA-01**: PostgreSQL data provisioning — determines which PostgreSQL data sources are available as channel types.
- **US-MGDATA-02**: MongoDB data provisioning — determines which MongoDB data sources are available as channel types.

## Risks

- **Event filter complexity**: If filters become too expressive, subscription resolution performance may degrade under high fan-out. Mitigation: keep the initial filter model simple (table/collection + operation type) and expand incrementally.
- **Quota race conditions**: Concurrent subscription creation under load could exceed quotas momentarily. Mitigation: use atomic quota checks at the persistence layer.
