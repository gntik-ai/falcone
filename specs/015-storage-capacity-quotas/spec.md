# Feature Specification: US-STO-02-T03 — Storage Capacity and Quota Guardrails

**Feature Branch**: `015-storage-capacity-quotas`  
**Task**: US-STO-02-T03  
**Epic**: EP-12 — Storage S3-compatible  
**Created**: 2026-03-28  
**Status**: Draft

---

## 1. Objective and Problem Statement

This task adds the product-facing behavior required to govern storage consumption with explicit, enforceable guardrails. The platform already assigns an initial tenant storage quota (`storageCapacityBytes`, `maxBuckets`) and already exposes bucket/object builders, upload previews, multipart completion previews, and policy evaluation helpers. What is still missing is a deterministic way to evaluate whether a requested bucket or object operation would exceed any configured storage guardrail before the runtime executes it.

Without this task, the platform can provision tenant storage contexts and model buckets/objects, but it cannot consistently answer questions such as:
- whether a tenant or workspace can create one more bucket,
- whether an upload or multipart completion would exceed the total assigned storage capacity,
- whether an object operation would exceed the allowed number of objects, or
- whether a single object is larger than the platform-governed object-size limit.

This task introduces that missing governance layer as a bounded capability: explicit quota profiles, scope-aware quota status, deterministic admission previews for bucket/object operations, and structured audit evidence for allow/deny decisions.

---

## 2. Users, Consumers, and Value

### Direct consumers

- **Storage runtime / control-plane services** need a deterministic quota guardrail evaluation surface before executing provider operations.
- **Workspace admins** need bucket/object operations to be rejected predictably when their workspace or tenant is at capacity.
- **Tenant owners** need storage guardrails to remain tenant-scoped and observable without provider-specific guesswork.
- **Superadmins** need a consistent audit trail that explains why a storage operation was blocked.

### Value delivered

- Prevents unbounded storage growth and runaway object ingestion.
- Makes quota enforcement explicit and testable instead of implicit or provider-dependent.
- Preserves multi-tenant isolation by evaluating both tenant-scope and workspace-scope limits.
- Provides a single platform interpretation for bucket-count, object-count, total-capacity, and per-object-size guardrails.

---

## 3. In-Scope Capability

### Core capability

The platform MUST evaluate storage admission guardrails for the following limit dimensions:

1. **Total capacity** — total bytes consumed in a tenant or workspace scope.
2. **Number of buckets** — maximum buckets allowed in a tenant or workspace scope.
3. **Number of objects** — maximum objects allowed in a tenant or workspace scope.
4. **Maximum size per object** — maximum bytes allowed for a single uploaded or completed object.

### Supported operations in this task

- previewing bucket admission against configured bucket-count limits,
- previewing object admission against configured total-capacity, object-count, and max-object-size limits,
- evaluating multipart completion with the same object-size and capacity guardrails as single-request uploads,
- producing structured violation records and audit events for allow/deny outcomes,
- surfacing the quota profile and effective limit status through the adapter catalog.

---

## 4. Out of Scope

- Provider-side hard enforcement or live provider mutations.
- Console UI, dashboards, charts, or quota-management UX.
- Metering persistence, background reconciliation, or asynchronous usage rollups.
- Policy authoring or permission workflows from `US-STO-02-T02`.
- Object-storage events from `US-STO-02-T04`.
- Provider capability exposure from `US-STO-02-T05`.
- End-to-end live-provider verification from `US-STO-02-T06`.
- Commercial-plan authoring changes outside the additive storage guardrail interpretation layer.

---

## 5. Functional Requirements

### FR-001 — Quota profile construction

The system MUST build a deterministic storage quota profile from tenant-scoped inputs, optional workspace overrides, current usage snapshots, and optional provider metadata.

### FR-002 — Scope-aware evaluation

The system MUST evaluate guardrails independently for at least the `tenant` scope and the `workspace` scope when both are present.

### FR-003 — Total-capacity enforcement

The system MUST reject a bucket/object admission preview when the post-operation total bytes for any evaluated scope would exceed its configured byte limit.

### FR-004 — Bucket-count enforcement

The system MUST reject a bucket admission preview when the post-operation bucket count for any evaluated scope would exceed its configured bucket limit.

### FR-005 — Object-count enforcement

The system MUST reject an object admission preview when the post-operation object count for any evaluated scope would exceed its configured object-count limit.

### FR-006 — Per-object-size enforcement

The system MUST reject an object admission preview when the requested object size exceeds the effective maximum-object-size limit for any evaluated scope.

### FR-007 — Multipart parity

The same object-size and capacity guardrails used for direct uploads MUST be usable for multipart-completion admission decisions.

### FR-008 — Additive error semantics

The system MUST expose a storage-quota-local error catalog that identifies which guardrail failed while mapping to the existing normalized storage error taxonomy (`STORAGE_QUOTA_EXCEEDED` or `STORAGE_OBJECT_TOO_LARGE`).

### FR-009 — Deterministic violation payloads

Each violation MUST identify, at minimum: scope, scope identifier, dimension, used value, requested delta, resulting value, configured limit, metric key when available, local reason code, and normalized storage code.

### FR-010 — Deterministic decision output

Each quota evaluation MUST return a frozen decision object with:
- `allowed`,
- `action`,
- `violations`,
- `effectiveViolation` (the most relevant blocking violation, if any),
- `quotaProfile`, and
- enough scope data for audit and operator inspection.

### FR-011 — Auditability

The system MUST be able to build a structured audit event for an allow or deny outcome without exposing secrets, presigned URLs, or provider credentials.

### FR-012 — Multi-tenant isolation

Quota evaluation MUST never mix usage or limits between unrelated tenants. A workspace-scoped preview must remain traceable to its parent tenant while still evaluating workspace-level limits independently.

### FR-013 — Partial configuration tolerance

If a specific limit dimension is absent for a given scope, that dimension MUST be treated as not configured for that scope rather than causing the entire evaluation to fail.

### FR-014 — Negative or zero deltas

The evaluation layer MUST support non-increasing deltas (for example overwrite with a smaller object, delete-style simulations, or zero-delta checks) without incorrectly triggering quota violations.

### FR-015 — Catalog exposure

The provider catalog MUST re-export the new storage quota guardrail builders, evaluators, preview helpers, audit builder, constants, and error catalog additively.

---

## 6. Business Rules and Governance

- Tenant-scoped limits are authoritative for the tenant boundary.
- Workspace-scoped limits can be stricter than tenant-scoped limits.
- An operation is allowed only when **all evaluated scopes** permit it.
- A single request can fail because of multiple guardrails; the decision surface must preserve the full violation list.
- The platform must distinguish between **capacity exhaustion** and **single-object oversize** because they map to different normalized storage outcomes.
- Missing limits are not interpreted as zero.
- Quota guardrail evaluation is deterministic and side-effect free in this task.

---

## 7. Key Scenarios

### Scenario 1 — Bucket creation allowed

Given a tenant/workspace quota profile with remaining bucket capacity, when the caller previews one additional bucket, then the preview is accepted and returns the updated quota posture.

### Scenario 2 — Bucket creation denied

Given a workspace already at its maximum bucket count, when the caller previews another bucket, then the preview is rejected with a bucket-limit reason that maps to `STORAGE_QUOTA_EXCEEDED`.

### Scenario 3 — Direct object upload allowed

Given sufficient total capacity, sufficient object-count headroom, and an object smaller than the configured max object size, when the caller previews an upload, then the preview is accepted.

### Scenario 4 — Direct object upload denied by capacity

Given a tenant at or near its byte limit, when the caller previews an upload whose delta would exceed that limit, then the preview is rejected with a capacity-limit reason.

### Scenario 5 — Direct object upload denied by object count

Given a workspace already at the configured object-count limit, when the caller previews one more object, then the preview is rejected with an object-count reason.

### Scenario 6 — Direct object upload denied by per-object size

Given a max-object-size limit smaller than the requested object, when the caller previews the upload, then the preview is rejected with an object-size reason that maps to `STORAGE_OBJECT_TOO_LARGE`.

### Scenario 7 — Multipart completion parity

Given a multipart completion candidate with a computed final object size, when quota evaluation is applied, then the same max-object-size and total-capacity rules are enforced as for a normal upload.

### Scenario 8 — Overwrite with smaller object

Given an existing object that is replaced by a smaller object, when the caller previews the replacement, then the byte delta can be negative and the evaluation remains valid.

---

## 8. Edge Cases

- Tenant scope allows the operation but workspace scope blocks it.
- Workspace scope allows the operation but tenant scope blocks it.
- A limit exists for buckets/bytes but not for objects.
- An object-size limit is configured only at one scope.
- Current usage is missing for one dimension while present for others.
- The requested delta is zero.
- A replacement upload shrinks total bytes.
- Multiple violations occur simultaneously (for example bytes and object count).
- Provider metadata is present but does not declare a numeric `maxObjectSizeBytes` constraint.

---

## 9. Permissions, Security, Audit, and Traceability

### Permissions

This task defines the evaluation layer only; authorization remains external. The evaluation output must remain safe to expose to authorized operators and internal services.

### Security

- No credential material may appear in quota profiles, violations, or audit events.
- No presigned URL or secret-like string may appear in audit output.
- Scope identifiers must remain explicit so blocked operations can be traced without cross-tenant ambiguity.

### Audit

Every allow/deny outcome should be representable through a structured audit event containing:
- action,
- tenant/workspace/bucket scope,
- evaluated dimensions,
- allow/deny outcome,
- effective violation if denied,
- actor identity reference,
- correlation identifier,
- timestamp.

### Traceability

This task traces directly to `US-STO-02-T03` and is intentionally scoped so downstream runtime layers can call a single guardrail surface before provider execution.

---

## 10. Acceptance Criteria

1. A deterministic quota profile can be built from tenant context, optional workspace limits, and current usage snapshots.
2. Bucket admission preview rejects when a tenant or workspace bucket-count limit would be exceeded.
3. Object admission preview rejects when a tenant or workspace total-byte limit would be exceeded.
4. Object admission preview rejects when a tenant or workspace object-count limit would be exceeded.
5. Object admission preview rejects when the requested object exceeds the effective max-object-size limit.
6. Multipart completion can be evaluated through the same quota surface as direct upload.
7. Violations carry local reason codes plus existing normalized storage codes.
8. Decision outputs and audit events are frozen and deterministic.
9. The provider catalog exposes the new quota guardrail helpers additively.
10. Existing storage adapter tests continue to pass without regressions.

---

## 11. Assumptions

- Existing tenant storage contexts already provide at least `storageCapacityBytes` and `maxBuckets`.
- Runtime callers can supply current usage snapshots for the scopes they want to evaluate.
- Provider metadata remains optional; the quota layer must not depend on live provider access.
- This task remains a pure-functional/data-shape layer consistent with prior storage adapter tasks.

---

## 12. Risks and Open Questions

### Risks

- If runtime callers provide stale usage snapshots, the evaluation may be accurate only relative to the snapshot.
- Different scopes may disagree on which limit is tighter; the decision layer must preserve all violations to avoid ambiguity.

### Non-blocking open question

- Future work may want commercial-plan-native metrics for object count and per-object size, but this task can proceed with additive explicit inputs and existing tenant-capacity defaults.
