# Feature Specification: Function Quota Guardrails

- **Feature branch:** `003-function-quota-guardrails`
- **Created:** 2026-03-27
- **Status:** Draft
- **Input:** User description: "Apply limits per tenant and workspace for number of functions, invocations, time of computation and memory accumulated. Backlog reference: US-FN-03-T03."

## 1. User Scenarios & Testing

### Primary user scenarios

1. **Workspace admins and tenant owners can understand their remaining capacity**
   - A privileged operator reviews the current quota posture for a tenant or workspace before creating or scaling function usage.
   - The operator can see what is limited, what has already been consumed, and what remains available within their own scope.

2. **Backend developers are blocked when a function action would exceed quota**
   - A developer attempts to create, activate, or invoke functions in a workspace that has already reached a relevant limit.
   - The product rejects the action clearly instead of allowing the scope to exceed its agreed guardrails.

3. **Tenant and workspace boundaries remain isolated under quota enforcement**
   - A user operating in one tenant or workspace cannot observe or affect the quota posture of another tenant or workspace.
   - Enforced limits remain specific to the caller’s own governance scope.

4. **Operators can distinguish which quota dimension was hit**
   - A function count, invocation count, cumulative compute time, or cumulative memory limit can each stop additional usage independently.
   - The product explains which guardrail was reached so the operator can respond appropriately.

### Testing expectations

- **Given** a workspace is below all configured limits, **when** an authorized user creates or invokes a function, **then** the action succeeds and quota usage is updated for that same scope.
- **Given** a tenant or workspace reaches the function-count limit, **when** a user tries to add another function, **then** the product rejects the request and does not increase the count beyond the limit.
- **Given** a tenant or workspace reaches an invocation, compute-time, or memory limit, **when** a user tries to execute another function, **then** the product denies the execution attempt with a clear quota-related result.
- **Given** a user tries to inspect quota status outside their tenant or workspace, **when** they request it, **then** the product reveals no cross-scope quota details.
- **Given** two requests arrive near the same limit threshold, **when** they are processed concurrently, **then** the platform still respects the configured limit and does not allow the scope to overshoot it.

## 2. Edge Cases

- **A tenant limit is exhausted while a workspace-specific limit still has room**
  - The stricter applicable limit must govern the action.

- **A workspace limit is exhausted while the tenant-level limit still has room**
  - The workspace must still be blocked because the workspace guardrail is authoritative for that scope.

- **Different quota dimensions are consumed independently**
  - A function may still be allowed by count but denied by invocation volume, compute time, or memory usage.

- **A scope has only one type of limit configured**
  - The product must still enforce the configured dimension without requiring all other dimensions to be present.

- **The operator retries an action after hitting a limit**
  - Retries must not bypass the guardrail or silently increase the allowed threshold.

- **A function is removed and quota capacity becomes available again**
  - The product should reflect the freed capacity within the same tenant or workspace scope.

- **A caller can perform function operations but cannot view quota administration details**
  - The action result must still be clear enough to explain why the request failed without exposing unrelated governance data.

## 3. Requirements

### Functional requirements

1. **Scoped quota guardrails**
   - The product MUST enforce quota guardrails separately for tenant scope and workspace scope.
   - The product MUST support guardrails for function count, invocation count, cumulative compute time, and cumulative memory usage.

2. **Quota evaluation before action completion**
   - The product MUST evaluate the relevant quota before allowing a function-related action that would increase usage.
   - The product MUST block the action when it would exceed the applicable limit.

3. **Strictest applicable limit wins**
   - When both tenant-level and workspace-level guardrails apply, the product MUST enforce the most restrictive applicable limit for the requested action.

4. **Clear quota rejection behavior**
   - When a limit is reached or would be exceeded, the product MUST reject the request with a clear, non-sensitive explanation of the quota dimension involved.
   - The product MUST distinguish between function-count, invocation-count, compute-time, and memory-related denials.

5. **Quota status visibility for authorized operators**
   - The product MUST allow authorized tenant and workspace operators to view their own quota posture, including current usage and remaining capacity where applicable.
   - The product MUST not expose another tenant’s or workspace’s quota posture.

6. **Cross-scope isolation**
   - The product MUST ensure quota usage and quota limits are attributed only to the correct tenant and workspace context.
   - The product MUST prevent one scope from consuming, reading, or altering another scope’s quota guardrails.

7. **Concurrent safety**
   - The product MUST prevent concurrent requests from pushing a tenant or workspace beyond a configured limit.
   - If multiple requests compete for the last available capacity, the product MUST keep the resulting usage within the allowed boundary.

8. **Function-count clarity**
   - The product MUST treat the function-count guardrail as the number of managed functions in the scope, not as historical revisions or sibling lifecycle records.

9. **Scope of responses**
   - The product MUST return enough information for operators to understand which limit was hit and what scope it applies to.
   - The product MUST NOT reveal unrelated tenant or workspace metadata when denying quota-restricted actions.

10. **Feature boundary**
    - The scope of this feature MUST remain limited to quota guardrails for functions and MUST NOT introduce secret management, versioning/rollback, console-backend execution, import/export, or expanded audit workflows reserved for sibling tasks.

### Key Entities

- **Tenant Quota Guardrail**: A limit that applies to all relevant function activity within a tenant.
- **Workspace Quota Guardrail**: A limit that applies to function activity within a single workspace.
- **Quota Dimension**: One measured category of usage, such as function count, invocation count, cumulative compute time, or cumulative memory usage.
- **Quota Status**: The current posture of a scope relative to its configured guardrails, including consumed amount and remaining capacity when available.
- **Quota Rejection**: A clear product response indicating that an action cannot proceed because a guardrail would be exceeded.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: An authorized operator can see the current quota posture for their own tenant or workspace without viewing other tenants’ or workspaces’ quota details.
- **SC-002**: A function action that would exceed a configured guardrail is rejected consistently rather than allowing the scope to overshoot the limit.
- **SC-003**: The product distinguishes which quota dimension caused a rejection so operators can tell whether the block came from function count, invocation volume, compute time, or memory usage.
- **SC-004**: Concurrent requests do not produce a final usage state above the configured limit for the same tenant or workspace.
- **SC-005**: Existing function operations continue normally while a scope remains under quota, and only quota-exceeding actions are blocked.

## 5. Assumptions

- Tenant and workspace scoping already exists and is enforced across the product.
- The product already has a way to determine which user roles may view quota status and which may act on function resources.
- Quota values or entitlement levels are managed elsewhere in the product lifecycle and are available to this feature as the current configured limits.
- This story focuses on product behavior for guardrails and does not require pricing, billing, or external usage reports.

## 6. Scope Boundaries

### In scope

- Tenant-scoped and workspace-scoped limits for function count, invocations, cumulative compute time, and cumulative memory usage.
- Enforcement behavior when a request would exceed a quota.
- User-visible quota status for authorized operators in their own scope.
- Isolation rules that prevent cross-tenant or cross-workspace quota influence.

### Out of scope

- `US-FN-03-T01`: Function versioning and rollback.
- `US-FN-03-T02`: Workspace secrets and secure secret references.
- `US-FN-03-T04`: Console backend execution in OpenWhisk consuming the same public APIs.
- `US-FN-03-T05`: Import/export of function and package definitions plus public/private web action visibility rules.
- `US-FN-03-T06`: Expanded audit coverage for deployment, administration, rollback, and quota enforcement evidence.
- Billing, pricing, chargeback, quota plan authoring, or automated remediation beyond simple enforcement and visibility.
