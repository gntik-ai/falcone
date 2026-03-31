# Feature Specification: Effective Limit Resolution

**Feature Branch**: `105-effective-limit-resolution`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Calcular límites efectivos combinando plan, overrides y subcuotas de workspace"  
**Task ID**: US-PLAN-02-T03  
**Epic**: EP-19 — Planes, límites y packaging del producto  
**Story**: US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo  
**Depends on**: US-PLAN-02-T01 (103-hard-soft-quota-overrides), US-PLAN-02-T02 (104-plan-boolean-capabilities)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Internal Service Resolves Effective Quantitative Limits for a Tenant (Priority: P1)

Any platform service (enforcement engine, console API, provisioning actions) that needs to know "how much can this tenant use?" queries a single resolution endpoint or function that returns the **effective limits** for every recognized quota dimension. The resolution follows a strict precedence hierarchy: **active override > plan base limit > catalog platform default**. The response clearly indicates, for each dimension, the effective value and its source (override, plan, or catalog default), so that consuming services can apply the correct enforcement behavior and display accurate information.

**Why this priority**: This is the core computation that every downstream consumer depends on — enforcement (T01), console visualization (T04), and gateway blocking (T05) all need the effective limit already resolved. Without a single, authoritative resolution point, each consumer would re-implement the merging logic, leading to inconsistencies.

**Independent Test**: Can be fully tested by configuring a plan with base limits, adding overrides for some dimensions, and querying effective limits — verifying that each dimension reflects the correct precedence.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is assigned the `starter` plan with `max_workspaces: 3` and `max_pg_databases: 5`, and no overrides exist, **When** the effective limits are resolved for `acme-corp`, **Then** the result shows `max_workspaces: 3 (source: plan)` and `max_pg_databases: 5 (source: plan)`.
2. **Given** tenant `acme-corp` is on the `starter` plan with `max_workspaces: 3`, and a superadmin override sets `max_workspaces: 10` for this tenant, **When** the effective limits are resolved, **Then** `max_workspaces: 10 (source: override)` is returned, while all other dimensions retain their plan-based or catalog-default values.
3. **Given** the `starter` plan does not explicitly set `max_kafka_topics` and the quota dimension catalog defines a platform default of `5` for that dimension, **When** the effective limits are resolved for a tenant on `starter`, **Then** `max_kafka_topics: 5 (source: catalog_default)` is returned.
4. **Given** a dimension is set to `-1` (unlimited) at the plan level and no override exists, **When** the effective limits are resolved, **Then** the dimension is returned as unlimited (`-1`, source: plan), and downstream consumers must skip quota checks for this dimension.
5. **Given** a dimension has an override that explicitly sets the value to `0`, **When** the effective limits are resolved, **Then** the dimension returns `0 (source: override)`, meaning the resource type is fully blocked for this tenant.

---

### User Story 2 — Internal Service Resolves Effective Boolean Capabilities for a Tenant (Priority: P1)

Beyond numeric quotas, the resolution must also return the **effective boolean capabilities** for a tenant, merging the plan's capability profile with catalog defaults. The result indicates, for each recognized capability, whether it is enabled or disabled and the source of that determination (explicit plan configuration or catalog default). This provides a single unified entitlements response combining both quantitative limits and qualitative capabilities.

**Why this priority**: Boolean capabilities and quantitative limits together define the full entitlement profile of a tenant. Resolving them in a single operation ensures consumers get a coherent, complete picture — not two separate lookups that might drift.

**Independent Test**: Can be fully tested by configuring capabilities on a plan, querying effective entitlements, and verifying all catalog capabilities appear with their resolved state.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` is on the `professional` plan which explicitly enables `realtime`, `webhooks`, and `sql_admin_api`, and the catalog defines 7 capabilities all defaulting to `false`, **When** effective capabilities are resolved, **Then** the response shows `realtime: true (source: plan)`, `webhooks: true (source: plan)`, `sql_admin_api: true (source: plan)`, and the remaining 4 capabilities as `false (source: catalog_default)`.
2. **Given** tenant `acme-corp` has no plan assigned, **When** effective capabilities are resolved, **Then** all capabilities default to their catalog default values and the source is `catalog_default` for every entry.
3. **Given** a new capability `batch_exports` is added to the catalog with default `false` but no plan has configured it yet, **When** effective capabilities are resolved for any tenant, **Then** `batch_exports: false (source: catalog_default)` appears in the response without requiring any plan updates.

---

### User Story 3 — Workspace Admin Allocates a Sub-Quota from the Tenant's Effective Limits (Priority: P1)

A tenant may contain multiple workspaces. A workspace admin (or tenant owner) allocates a portion of the tenant's effective limits to a specific workspace, creating a **workspace sub-quota**. The sub-quota constrains that workspace to consume no more than the allocated amount for a given dimension. The sum of all workspace sub-quotas for a dimension must not exceed the tenant's effective limit for that dimension. If no sub-quota is set for a workspace on a given dimension, the workspace shares the tenant-level pool without a specific reservation.

**Why this priority**: In a multi-workspace tenant, without sub-quotas, one workspace can consume the entire tenant allocation and starve others. Sub-quotas enable fair resource distribution and predictable capacity planning across workspaces within a tenant.

**Independent Test**: Can be fully tested by creating multiple workspaces under a tenant, allocating sub-quotas, verifying the allocations persist, and confirming the system rejects allocations that would exceed the tenant's effective limit.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has an effective limit of `max_pg_databases: 10` and two workspaces (`ws-dev` and `ws-prod`), **When** the workspace admin allocates `max_pg_databases: 4` to `ws-dev` and `max_pg_databases: 6` to `ws-prod`, **Then** both allocations are persisted and the total (10) equals the tenant's effective limit.
2. **Given** tenant `acme-corp` has an effective limit of `max_pg_databases: 10`, `ws-dev` already has a sub-quota of `4`, **When** the workspace admin attempts to allocate `max_pg_databases: 8` to `ws-prod`, **Then** the request is rejected because `4 + 8 = 12` exceeds the tenant-level effective limit of `10`.
3. **Given** workspace `ws-staging` has no sub-quota set for `max_functions`, **When** a function is created in `ws-staging`, **Then** the function consumes from the tenant-level pool for `max_functions` without any workspace-specific limit.
4. **Given** a tenant has 3 workspaces with sub-quotas totaling `9` out of an effective limit of `10`, **When** the workspace admin queries the allocation status, **Then** the response shows `1` unit is unallocated (available for the shared pool or further workspace allocation).
5. **Given** a dimension is set to unlimited (`-1`) at the tenant's effective level, **When** the workspace admin attempts to set a sub-quota for that dimension, **Then** the allocation is accepted because unlimited at the tenant level allows any finite workspace sub-quota.

---

### User Story 4 — System Resolves Workspace-Level Effective Limits (Priority: P1)

When the enforcement engine or any service needs to know the effective limits for a **specific workspace**, the system resolves them as follows: if a workspace sub-quota exists for a dimension, that is the workspace's effective limit; if no sub-quota exists, the workspace draws from the tenant-level effective limit (shared pool). The response includes both the workspace-specific limit (if any) and the tenant-level effective limit for context.

**Why this priority**: Workspace-level resolution is the final piece that connects tenant-level entitlements to the actual enforcement boundary. Without it, enforcement cannot differentiate between workspaces under the same tenant.

**Independent Test**: Can be fully tested by setting sub-quotas on some workspaces and not others, then resolving workspace-level effective limits and verifying sub-quota-bound workspaces get their allocation while unbound workspaces inherit the tenant pool.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has effective `max_pg_databases: 10`, workspace `ws-prod` has sub-quota `max_pg_databases: 6`, **When** the workspace-level effective limits are resolved for `ws-prod`, **Then** the result shows `max_pg_databases: 6 (source: workspace_sub_quota)` with tenant-level context `10 (source: override/plan)`.
2. **Given** workspace `ws-dev` has no sub-quota for `max_pg_databases`, **When** the workspace-level effective limits are resolved, **Then** the result shows `max_pg_databases: shared_pool` with the tenant-level effective limit of `10`, meaning usage is limited only by the tenant pool.
3. **Given** workspace `ws-prod` has sub-quota `max_functions: 30` and the tenant's effective limit for `max_functions` is `50`, **When** the workspace-level limits are resolved for `ws-prod`, **Then** `max_functions: 30 (source: workspace_sub_quota)` is returned.
4. **Given** a capability `realtime` is disabled at the tenant level, **When** the workspace-level entitlements are resolved, **Then** `realtime: false` is reported regardless of any workspace setting, because boolean capabilities are resolved at tenant-plan level, not at workspace level.

---

### User Story 5 — Effective Limits Automatically Reflect Changes in Plan, Override, or Sub-Quota (Priority: P2)

When any upstream input changes — the tenant's assigned plan is changed, an override is created/modified/revoked, or a workspace sub-quota is updated — the effective limits resolve to the new values on the next query. There is no separate "recalculation" step; resolution is always computed fresh from the current state of plan, overrides, and sub-quotas. If a change causes an existing sub-quota to exceed the new effective limit, the system flags the inconsistency but does NOT retroactively revoke the sub-quota.

**Why this priority**: Dynamic consistency with upstream changes is essential for correctness, but the system should never silently break existing allocations. Flagging inconsistencies instead of auto-revoking gives operators time to remediate.

**Independent Test**: Can be fully tested by changing the plan or revoking an override and then re-querying effective limits and sub-quota status.

**Acceptance Scenarios**:

1. **Given** tenant `acme-corp` has override `max_workspaces: 10` and workspace `ws-prod` has sub-quota `max_workspaces: 7`, **When** the superadmin revokes the override (reverting to plan base `max_workspaces: 3`), **Then** the tenant's effective limit becomes `3`, and the workspace sub-quota of `7` is flagged as exceeding the new tenant effective limit.
2. **Given** tenant `acme-corp` upgrades from `starter` (base `max_functions: 50`) to `professional` (base `max_functions: 200`), **When** effective limits are resolved, **Then** the new value is `200 (source: plan)` immediately, with no action required on existing sub-quotas.
3. **Given** the system detects a workspace sub-quota that exceeds its tenant's effective limit, **Then** the inconsistency is surfaced in both the sub-quota query response and as a warning event, but the sub-quota value is NOT automatically changed.

---

### User Story 6 — Audit Trail for Sub-Quota Lifecycle and Effective Limit Queries (Priority: P2)

Every sub-quota creation, modification, or removal is audited with actor, tenant, workspace, dimension, previous and new value. Effective-limit resolution queries by internal services are NOT individually audited (they are high-frequency), but sub-quota inconsistencies flagged during resolution ARE recorded as warning events.

**Why this priority**: Sub-quota governance requires the same auditability standard as overrides. Resolution queries are too frequent to log individually, but inconsistency detection is an important operational signal.

**Independent Test**: Can be fully tested by creating, modifying, and removing sub-quotas and verifying audit records exist for each lifecycle event.

**Acceptance Scenarios**:

1. **Given** a workspace admin allocates `max_pg_databases: 4` to `ws-dev`, **Then** an audit event is recorded with actor, tenant, workspace, dimension `max_pg_databases`, previous value (none), and new value `4`.
2. **Given** a workspace admin modifies the sub-quota for `ws-dev` from `4` to `6`, **Then** an audit event captures the change with previous value `4` and new value `6`.
3. **Given** the system detects that `ws-prod`'s sub-quota of `7` for `max_workspaces` exceeds the tenant's new effective limit of `3`, **Then** a warning event is emitted with tenant, workspace, dimension, sub-quota value, and current tenant effective limit.

---

### Edge Cases

- What happens when a tenant has no plan assigned? All quantitative limits default to the catalog platform defaults, all capabilities default to catalog defaults, and no workspace sub-quotas are possible (since the base entitlement may be zero for most dimensions).
- What happens when the total of existing workspace sub-quotas is valid but a plan downgrade causes the tenant effective limit to drop below the sum? The sub-quotas remain as-is but are flagged as inconsistent. No workspace loses its allocation automatically. The tenant owner or superadmin must manually remediate.
- What happens when a workspace is deleted but had sub-quota allocations? The sub-quota records for that workspace are soft-deleted or archived. The freed capacity becomes available in the tenant-level pool.
- What happens when an override expires and the plan base limit is lower than the previously overridden value? The effective limit drops to the plan base. Any workspace sub-quotas that now exceed the new effective limit are flagged as inconsistent.
- What happens when two workspace admins concurrently allocate sub-quotas that together would exceed the tenant limit? The system uses serializable or row-level locking on the tenant's allocation pool so that only one allocation succeeds and the second is rejected with a clear error.
- What happens when a dimension is set to `0` at the tenant level? No workspace sub-quotas can be allocated for that dimension (since any positive allocation would exceed `0`), and the workspace-level resolution returns `0` (fully blocked).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a resolution operation that computes effective quantitative limits for a tenant by applying the precedence hierarchy: active override > plan base limit > catalog platform default.
- **FR-002**: The effective-limit response for each quota dimension MUST include: the effective numeric value, the source of that value (`override`, `plan`, or `catalog_default`), and the quota type classification (hard or soft with grace margin) from the source.
- **FR-003**: The system MUST provide a resolution operation that computes effective boolean capabilities for a tenant by merging the plan's explicit capability configuration with the capability catalog defaults.
- **FR-004**: The effective-capability response for each recognized capability MUST include: the effective state (enabled/disabled), a display-friendly label, and the source (`plan` or `catalog_default`).
- **FR-005**: The system MUST support a unified entitlements query that returns both effective quantitative limits and effective boolean capabilities for a tenant in a single response.
- **FR-006**: The system MUST support workspace sub-quota allocation, where a workspace admin or tenant owner assigns a portion of the tenant's effective limit for a given dimension to a specific workspace.
- **FR-007**: The sum of all workspace sub-quotas for a given dimension MUST NOT exceed the tenant's effective limit for that dimension at the time of allocation. The system MUST reject allocations that would exceed this constraint.
- **FR-008**: When no workspace sub-quota is set for a dimension, the workspace MUST consume from the tenant-level shared pool without a workspace-specific cap.
- **FR-009**: The system MUST provide workspace-level effective limit resolution that returns: the workspace sub-quota (if set) or an indication that the workspace uses the shared tenant pool, plus the tenant-level effective limit for context.
- **FR-010**: Boolean capabilities MUST be resolved exclusively at the tenant-plan level. Workspace sub-quotas apply only to quantitative dimensions, not to capabilities.
- **FR-011**: When upstream inputs change (plan assignment, override creation/modification/revocation, sub-quota update), the effective-limit resolution MUST reflect the new state on the next query without requiring an explicit recalculation trigger.
- **FR-012**: If a change to plan, override, or assignment causes an existing workspace sub-quota to exceed the new tenant effective limit, the system MUST flag the inconsistency as a warning but MUST NOT automatically modify or revoke the sub-quota.
- **FR-013**: The system MUST emit an auditable event for every workspace sub-quota creation, modification, or removal, including actor, tenant identifier, workspace identifier, dimension, previous value, and new value.
- **FR-014**: The system MUST emit a warning event when a sub-quota inconsistency is detected during resolution (sub-quota exceeds tenant effective limit).
- **FR-015**: Sub-quota allocation MUST enforce multi-tenant isolation — a workspace admin can only allocate sub-quotas within their own tenant's workspaces and cannot see or affect other tenants' allocations.
- **FR-016**: The resolution of effective limits MUST handle the unlimited sentinel (`-1`) correctly: a tenant-level unlimited dimension permits any finite workspace sub-quota; a workspace sub-quota of `-1` is not permitted (only the tenant level can be unlimited).
- **FR-017**: Only the following actors MUST be permitted to manage workspace sub-quotas: tenant owner (for any workspace in their tenant) and workspace admin (for their specific workspace). Superadmins MUST also be able to manage sub-quotas for governance purposes.
- **FR-018**: Concurrent sub-quota allocations for the same tenant and dimension MUST be serialized to prevent the total from exceeding the tenant's effective limit due to race conditions.

### Key Entities

- **Effective Entitlement Profile**: The unified result of resolving a tenant's quantitative limits and boolean capabilities. Contains one entry per recognized quota dimension (effective value, source, quota type) and one entry per recognized capability (effective state, source, display label). This is a computed view, not persisted.
- **Workspace Sub-Quota**: An allocation of a portion of a tenant's effective limit for a specific quota dimension to a specific workspace. Contains: tenant identifier, workspace identifier, dimension key, allocated value, created/updated timestamps, and actor. Workspace sub-quotas are persisted and auditable.
- **Workspace Effective Limits**: The resolved limits for a specific workspace: for dimensions with sub-quotas, the sub-quota value; for dimensions without sub-quotas, an indication that the workspace uses the shared tenant pool. Includes tenant-level context.
- **Sub-Quota Inconsistency Flag**: A transient marker surfaced when a workspace sub-quota exceeds the current tenant effective limit due to upstream changes. Not persisted as a separate entity but included in resolution responses and emitted as a warning event.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Any platform service can obtain the complete effective entitlement profile (all quantitative limits and all boolean capabilities) for a tenant in a single query, with each entry annotated by source.
- **SC-002**: Workspace sub-quota allocations that would cause the total across workspaces to exceed the tenant's effective limit are rejected 100% of the time, even under concurrent requests.
- **SC-003**: When a plan, override, or sub-quota changes, the next effective-limit query reflects the updated values without manual intervention.
- **SC-004**: Every sub-quota lifecycle event (create, modify, remove) is auditable with full actor and context information within 5 seconds of the action.
- **SC-005**: Sub-quota inconsistencies caused by upstream changes are detected and surfaced as warning events within the resolution response, enabling operators to remediate before enforcement issues arise.
- **SC-006**: Workspace-level effective limit resolution correctly distinguishes between sub-quota-bound workspaces and shared-pool workspaces for every quota dimension.
