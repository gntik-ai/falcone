# Feature Specification: Tenant Storage Context Provisioning

**Feature Branch**: `008-tenant-storage-context`  
**Created**: 2026-03-27  
**Status**: Draft  
**Input**: User description: "Provision logical storage context per active tenant. Backlog reference: US-STO-01-T02."

**Compatibility note**: This is the second task in the US-STO-01 story (EP-12 — Storage S3-compatible). It establishes the per-tenant logical storage context that bridges the provider abstraction layer (T01) with bucket/object CRUD (T03), logical organization by tenant/workspace/application (T04), error normalization (T05), and multi-provider test suites (T06). It assumes that the storage provider abstraction layer (US-STO-01-T01) is available, that tenant provisioning (US-TEN-01) and the plugin/provider registration model (US-PRG-02) are operational, and that the domain bootstrap contract already declares a `default_storage_bucket` as an always-created, workspace-scoped managed resource. This task does not implement bucket CRUD, object operations, logical organization by workspace/application, error normalization, or multi-provider verification suites; those are owned by sibling tasks T03–T06.

## 1. User Scenarios & Testing

### Primary user scenarios

1. **A new tenant activation provisions its storage context automatically** (Priority: P1)
   - When a tenant reaches the `active` lifecycle state, the platform provisions a logical storage context for that tenant through the storage provider abstraction layer.
   - The storage context establishes the tenant's isolated presence in the storage subsystem: a dedicated namespace, isolated credentials, initial quota assignment, and the metadata needed for downstream workspace-level provisioning.
   - The tenant owner does not perform manual storage setup; provisioning is automatic and idempotent.

   **Why this priority**: Without a tenant storage context, no workspace under that tenant can provision buckets or perform object operations. This is the foundational enabler between the provider abstraction (T01) and all tenant-facing storage features.

   **Independent Test**: Can be verified by activating a new tenant and confirming that the storage context exists, is isolated, contains valid credentials, and reports its provisioning status.

   **Acceptance Scenarios**:
   1. **Given** a tenant transitions to the `active` state, **when** the provisioning orchestrator processes the tenant activation, **then** a logical storage context is created for that tenant with an isolated namespace, dedicated credentials, and an initial quota assignment.
   2. **Given** a tenant already has a provisioned storage context, **when** the provisioning flow runs again for the same tenant, **then** the operation is idempotent and does not create a duplicate context or overwrite existing credentials.
   3. **Given** a tenant activation fails partway through storage context provisioning, **when** the provisioning is retried, **then** it resumes from the last successful step and completes without side effects from the partial attempt.

---

1. **A workspace bootstrap provisions the default storage bucket using the tenant's storage context** (Priority: P1)
   - When a workspace is created under an active tenant, the platform provisions the `default_storage_bucket` managed resource using the tenant's already-provisioned storage context.
   - The workspace bucket inherits the tenant's namespace isolation and respects the tenant's storage quota boundaries.

   **Why this priority**: The domain bootstrap contract declares `default_storage_bucket` as always-created and workspace-scoped. This scenario validates that T02's tenant context feeds correctly into the existing bootstrap pipeline.

   **Independent Test**: Can be verified by creating a workspace under an active tenant and confirming that the default storage bucket is provisioned, scoped within the tenant's namespace, and registered as a `managed_resource`.

   **Acceptance Scenarios**:
   1. **Given** a tenant has a provisioned storage context, **when** a new workspace is created under that tenant, **then** the default storage bucket is provisioned within the tenant's storage namespace and registered as a managed resource.
   2. **Given** a tenant's storage context does not exist (e.g., provisioning failed), **when** a workspace bootstrap attempts to provision the default bucket, **then** the bucket provisioning fails clearly and reports the missing tenant storage context as the reason.

---

1. **Tenant owners and superadmins can inspect the storage context status for a tenant** (Priority: P2)
   - An authorized operator queries the storage context for a tenant to verify provisioning status, namespace identity, quota assignment, and credential health.
   - This visibility supports operational troubleshooting and capacity planning.

   **Why this priority**: Introspection is essential for operations and debugging but is not required for the core provisioning flow to function.

   **Independent Test**: Can be verified by querying the storage context for a provisioned tenant and confirming it returns accurate status, namespace, and quota information without exposing raw credentials.

   **Acceptance Scenarios**:
   1. **Given** a tenant has a provisioned storage context, **when** a tenant owner or superadmin requests storage context introspection, **then** the response includes provisioning status, namespace identifier, quota assignment summary, and credential health without exposing raw credential values.
   2. **Given** a user without tenant-owner or superadmin role, **when** they attempt to inspect a tenant's storage context, **then** the request is denied.
   3. **Given** a user who is tenant owner of tenant A, **when** they attempt to inspect storage context for tenant B, **then** the request is denied.

---

1. **Tenant suspension or soft deletion cascades to the storage context** (Priority: P2)
   - When a tenant is suspended, the storage context is marked as suspended: no new bucket provisioning is allowed, and existing credentials are revoked or disabled.
   - When a tenant is soft-deleted, the storage context enters a terminal state. Actual data deletion follows the platform's purge policy and is outside T02 scope.

   **Why this priority**: Lifecycle cascade is essential for security and data governance but occurs after the primary provisioning flow.

   **Independent Test**: Can be verified by suspending a tenant and confirming that storage context credential access is revoked and new bucket provisioning is blocked.

   **Acceptance Scenarios**:
   1. **Given** a tenant is suspended, **when** the lifecycle cascade reaches the storage context, **then** the context transitions to `suspended`, credentials become non-functional, and attempts to provision new buckets under that tenant are rejected.
   2. **Given** a suspended tenant is reactivated, **when** the lifecycle cascade reaches the storage context, **then** the context transitions back to `active` and credentials are restored or reissued.
   3. **Given** a tenant is soft-deleted, **when** the lifecycle cascade reaches the storage context, **then** the context transitions to `soft_deleted` and all credentials are permanently revoked.

---

1. **The platform prevents cross-tenant storage context interference** (Priority: P1)
   - Each tenant's storage context is isolated so that credentials, namespace, and quota are never shared or visible to another tenant.
   - Cross-tenant operations through the storage abstraction are structurally impossible.

   **Why this priority**: Multi-tenant isolation is a non-negotiable security property and must be validated from the start.

   **Independent Test**: Can be verified by provisioning two tenants and confirming that each has a distinct namespace, distinct credentials, and that operations scoped to one tenant cannot access the other tenant's namespace.

   **Acceptance Scenarios**:
   1. **Given** two active tenants each with a provisioned storage context, **when** tenant A's credentials are used, **then** only tenant A's namespace is accessible and no object or bucket from tenant B is visible.
   2. **Given** a service or internal consumer provides a tenant identifier, **when** it requests the storage context, **then** only the context for the specified tenant is returned and no other tenant's metadata is leaked.

---

### Edge Cases

- **A tenant is activated but the storage provider is unavailable (T01 subsystem not initialized)**: The provisioning orchestrator MUST record a retriable failure on the storage context step and emit a provisioning event with the failure reason. It MUST NOT block the rest of tenant activation; the storage context step MUST be independently retryable.
- **Two concurrent tenant activations race for the same tenant identifier**: The provisioning flow MUST be idempotent. Only one storage context is created, and the second attempt either succeeds silently (idempotent) or detects the existing context and skips creation.
- **The commercial plan for the tenant does not include storage capability**: The storage context provisioning MUST check the effective-capability resolution for the tenant's plan and deployment profile. If the storage capability (`data.storage.bucket`) is not available, the context is not provisioned and a clear "capability not available" status is recorded.
- **A workspace is created before the tenant's storage context provisioning has completed**: The workspace bootstrap MUST detect the pending or missing storage context and defer bucket provisioning, recording a dependency-wait status on the managed resource.
- **Credential rotation for the tenant's storage context**: The platform MUST support credential rotation for a tenant's storage context without requiring re-provisioning of the entire context or its downstream workspaces and buckets.

## 2. Requirements

### Functional Requirements

- **FR-001**: The product MUST automatically provision a logical storage context for each tenant that transitions to the `active` lifecycle state and whose effective capability resolution includes `data.storage.bucket`.
- **FR-002**: Each tenant storage context MUST include, at minimum: a unique namespace identifier for isolation, dedicated storage credentials, a reference to the active storage provider (via T01 abstraction), an initial quota assignment, and lifecycle state metadata.
- **FR-003**: The product MUST ensure that each tenant's storage namespace is unique, deterministic (derivable from the tenant identifier), and not guessable from another tenant's namespace.
- **FR-004**: Storage credentials provisioned for a tenant MUST be dedicated to that tenant, stored through the platform's secret management mechanism, and MUST NOT appear in logs, API responses, or audit events.
- **FR-005**: The provisioning of the tenant storage context MUST be idempotent. Repeated provisioning for the same tenant MUST NOT create duplicate contexts, duplicate credentials, or duplicate namespaces.
- **FR-006**: The product MUST emit structured provisioning events to the event backbone (Kafka) for every storage context provisioning attempt: initiated, succeeded, failed (with retriable/terminal classification), suspended, reactivated, and soft-deleted.
- **FR-007**: The product MUST cascade tenant lifecycle transitions to the storage context: suspension MUST revoke or disable credentials and block new provisioning; reactivation MUST restore or reissue credentials; soft deletion MUST permanently revoke credentials.
- **FR-008**: The product MUST allow authorized operators (tenant owner and superadmin) to inspect the storage context status for a tenant, including provisioning state, namespace identifier, quota assignment, and credential health, without exposing raw credential values.
- **FR-009**: The product MUST deny storage context introspection to any actor who is not the tenant's owner or a superadmin, and MUST enforce tenant-boundary isolation so that a tenant owner for tenant A cannot inspect tenant B's context.
- **FR-010**: The product MUST support credential rotation for a tenant's storage context without requiring re-provisioning of the context or disrupting active workspace buckets.
- **FR-011**: When a workspace is created under a tenant with a provisioned storage context, the platform MUST use that context to provision the `default_storage_bucket` managed resource within the tenant's storage namespace.
- **FR-012**: When a workspace is created under a tenant whose storage context is missing or in a non-active state, the product MUST defer bucket provisioning and record a clear dependency-wait or failure status on the managed resource.
- **FR-013**: The product MUST assign an initial storage quota to each tenant storage context, derived from the tenant's commercial plan and quota policy. The quota MUST express, at minimum, total storage capacity and maximum number of buckets.
- **FR-014**: The product MUST NOT allow cross-tenant access through the storage context. Credentials, namespaces, and quota allocations are strictly tenant-scoped.
- **FR-015**: The product MUST record every provisioning step and lifecycle transition on the storage context with sufficient detail for the audit module to reconstruct the full provisioning history, including actor, correlation identifier, tenant binding, timestamp, and outcome.

### Key Entities

- **Tenant Storage Context**: The logical representation of a tenant's presence in the storage subsystem. Contains the namespace identifier, credential reference, storage provider reference, quota assignment, lifecycle state, and provisioning metadata. Scoped to exactly one tenant. Follows the standard entity lifecycle: `draft → provisioning → active → suspended → soft_deleted`.
- **Storage Credential Reference**: A pointer to the tenant's dedicated storage credentials held in the platform's secret management layer. The reference is stored in the context; the secret material is not.
- **Storage Namespace**: A deterministic, unique, tenant-scoped isolation boundary within the storage provider. Workspace buckets and objects exist within this namespace. The namespace guarantees that cross-tenant access is structurally impossible at the storage-provider level.
- **Storage Quota Assignment**: The initial storage limits assigned to a tenant's storage context, derived from the tenant's plan and quota policy. Includes total capacity and maximum bucket count. Full quota enforcement mechanics are outside T02 scope.
- **Storage Context Provisioning Event**: A structured event emitted to the event backbone capturing each provisioning lifecycle transition (initiated, succeeded, failed, suspended, reactivated, soft-deleted) with actor, correlation, tenant, timestamp, and outcome.

## 3. Success Criteria

### Measurable Outcomes

- **SC-001**: Activating a new tenant whose plan includes storage capability results in a fully provisioned storage context with an isolated namespace, valid credentials, and a correct quota assignment, without manual intervention.
- **SC-002**: Creating a workspace under a tenant with an active storage context results in a `default_storage_bucket` managed resource provisioned within the tenant's storage namespace.
- **SC-003**: Two tenants provisioned on the same platform have non-overlapping namespaces and distinct credentials, and neither tenant's credentials can access the other's namespace.
- **SC-004**: Suspending a tenant causes its storage context credentials to become non-functional and blocks new bucket provisioning under that tenant.
- **SC-005**: Reactivating a suspended tenant restores storage context functionality and allows new workspace bucket provisioning.
- **SC-006**: An authorized tenant owner can inspect their own storage context status; an unauthorized user or a different tenant's owner cannot.
- **SC-007**: Every storage context lifecycle transition produces a corresponding event on the event backbone that the audit module can capture.
- **SC-008**: Retrying storage context provisioning after a partial failure completes successfully without creating duplicate resources.

## 4. Governance and Cross-Cutting Concerns

### Multi-tenancy

- The storage context is **tenant-scoped**. Each active tenant with the storage capability enabled receives exactly one storage context.
- The namespace isolation boundary is enforced at the storage-provider level (via T01 abstraction), not only at the application level. This means that even a misconfigured internal consumer with valid credentials for tenant A cannot reach tenant B's namespace.
- Workspace-level bucket provisioning is downstream of the tenant context: a workspace inherits its tenant's namespace and operates within it.
- The provisioning flow respects the existing `managed_resource` model. The `default_storage_bucket` is registered as a workspace-scoped managed resource of kind `storage_bucket` with provider `storage`, consistent with the domain bootstrap contract.

### Permissions

- **Storage context provisioning** is triggered by the provisioning orchestrator during tenant activation. It is not a user-facing action.
- **Storage context introspection** requires the `tenant_owner` role for the target tenant, or the `superadmin` platform role.
- **Credential rotation** requires the `tenant_owner` role for the target tenant, or the `superadmin` platform role.
- The resolved authorization context (per ADR 0005) must include tenant binding and role verification before any storage context operation is executed.
- Workspace admins and developers cannot directly access or modify the tenant's storage context; they interact with storage through workspace-scoped bucket and object operations (T03 and beyond).

### Auditing

- Every storage context lifecycle event (FR-006, FR-015) MUST be emitted to the event backbone (Kafka) with the standard audit envelope: entity type, entity identifier, tenant binding, transition identifier, state before and after, actor, correlation identifier, and timestamp.
- The audit module MUST be able to reconstruct the complete provisioning history for any tenant storage context from these events.
- Credential rotation events MUST be audited separately, recording the rotation initiator and timestamp without exposing credential material.

### Quotas and Limits

- Each tenant storage context carries an initial quota assignment derived from the tenant's plan and the platform's quota policy.
- The initial quota dimensions are: total storage capacity (bytes) and maximum number of buckets.
- Full quota enforcement (blocking operations when limits are exceeded, usage metering, operator visibility into consumption vs. limits) is outside T02 scope and belongs to downstream tasks. T02 only establishes the quota assignment record so that enforcement has a baseline to operate against.
- The quota assignment follows the governance catalog interpretation rule: a storage operation is permitted only when the plan grants it, the deployment profile includes the storage capability, the capability is available, and no quota guardrail blocks it.

### Security

- Tenant storage credentials MUST be stored in the platform's secret management mechanism, never in plain text, and never exposed in logs, API responses, events, or audit records.
- Namespace identifiers MUST not be trivially guessable from tenant identifiers (e.g., a tenant slug alone). A derived, non-reversible mapping or platform-assigned identifier is preferred.
- Credential revocation on tenant suspension MUST take effect immediately; there MUST be no grace period during which revoked credentials remain functional.
- The product MUST NOT fall back to platform-level or shared credentials when a tenant's credentials are revoked.

### Observability

- The storage context provisioning status MUST be queryable by the platform health system so operators can detect tenants with failed or pending storage provisioning.
- Provisioning latency (time from tenant activation to storage context active) SHOULD be measurable through the emitted events.

## 5. Assumptions

- The storage provider abstraction layer (US-STO-01-T01) is available and can initialize against the configured provider.
- The tenant provisioning pipeline (US-TEN-01) emits lifecycle events that the provisioning orchestrator can consume to trigger storage context provisioning.
- The platform's secret management mechanism can create, read, revoke, and rotate credentials at runtime.
- The governance catalog (plans, quota policies, deployment profiles, provider capabilities) is resolvable at provisioning time to determine whether a tenant is entitled to storage capability.
- The event backbone (Kafka) is available for publishing provisioning and lifecycle events.
- The existing `managed_resource` entity model and the `default_storage_bucket` bootstrap resource definition are stable and do not require modification for T02.
- The provisioning orchestrator supports step-level idempotency and retriable-vs-terminal failure classification, as established by ADR 0003.

## 6. Scope Boundaries

### In scope

- Automatic provisioning of a logical storage context when a tenant becomes active and is entitled to storage capability.
- Per-tenant namespace isolation within the storage provider.
- Per-tenant dedicated credential provisioning and lifecycle management (create, revoke, restore, rotate).
- Initial storage quota assignment derived from the tenant's plan and quota policy.
- Storage context lifecycle cascade on tenant suspension, reactivation, and soft deletion.
- Introspection of storage context status for authorized operators.
- Provisioning event emission for audit and observability.
- Integration with the workspace bootstrap pipeline for `default_storage_bucket` provisioning using the tenant's context.
- Idempotent and retriable provisioning flow.

### Out of scope

- `US-STO-01-T01`: Storage provider abstraction layer and configuration-based provider selection (assumed available).
- `US-STO-01-T03`: Bucket CRUD and object operations (upload, download, delete, list, metadata).
- `US-STO-01-T04`: Logical organization by tenant, workspace, and application (hierarchical path conventions, prefixes, metadata tagging).
- `US-STO-01-T05`: Error normalization and minimum common capability enforcement across providers.
- `US-STO-01-T06`: Multi-provider test suites.
- Full storage quota enforcement (blocking operations on limit breach, real-time usage metering, consumption dashboards). T02 only establishes the quota assignment record.
- Presigned URL generation, multipart upload orchestration, bucket policies, object lifecycle rules, and storage event notifications.
- Data migration, cross-provider replication, or retention compliance beyond the basic credential revocation on soft deletion.
- Console UI for storage context management; this task covers the backend capability only.
- Physical data purge on tenant deletion; the purge policy is a platform-level concern outside this feature.

## 7. Risks and Open Questions

### Risks

- **Risk**: The storage provider may not support namespace-level isolation natively (e.g., some S3-compatible providers have flat bucket namespaces). **Mitigation**: The namespace can be implemented as a deterministic bucket-name prefix or a dedicated IAM policy boundary, depending on provider capabilities declared via T01's capability manifest. The T02 contract must be provider-agnostic at the logical level.
- **Risk**: Credential revocation latency on tenant suspension may leave a window where revoked credentials are temporarily functional. **Mitigation**: The product must issue the revocation synchronously within the lifecycle cascade and treat eventual consistency in the storage provider as a documented operational constraint rather than ignoring the gap.
- **Risk**: If the governance catalog is not fully resolved at tenant activation time, storage context provisioning may fail or provision with incorrect quotas. **Mitigation**: Provisioning should validate effective-capability resolution before creating the context and fail clearly if resolution is incomplete.

### Open Questions

- **OQ-001**: Should the storage namespace be a human-readable derivative of the tenant slug or a platform-generated opaque identifier? **Impact**: Affects debuggability vs. security. An opaque identifier is safer but harder to correlate during operations. A prefixed derivative (e.g., `ten-<hash>-<suffix>`) balances both. This does not block specification but should be decided during planning.
- **OQ-002**: Should credential rotation trigger re-provisioning of workspace-level bucket access, or should workspace buckets inherit the rotated credentials transparently? **Impact**: Affects complexity of the rotation flow. Transparent inheritance is simpler and preferred, but depends on how the storage provider handles IAM delegation. This can be deferred to planning.
