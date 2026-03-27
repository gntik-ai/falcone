# Feature Specification: Storage Provider Error Taxonomy and Minimum Common Capabilities

**Feature Branch**: `011-storage-provider-error-taxonomy`  
**Created**: 2026-03-27  
**Specified**: 2026-03-27  
**Status**: Specified  
**Task ID**: US-STO-01-T05  
**Epic**: EP-12 — Storage S3-compatible  
**Story**: US-STO-01 — Abstracción S3-compatible, aprovisionamiento lógico y operaciones de buckets/objetos  
**Input**: Backlog prompt: "Normalizar errores y capacidades mínimas comunes a todos los proveedores soportados."

**Compatibility note**: This is the fifth task in the `US-STO-01` story (`EP-12 — Storage S3-compatible`). It delivers a normalized error taxonomy and a minimum-capability contract that every supported S3-compatible provider must satisfy, so the rest of the platform can handle storage failures and provider differences uniformly. It depends on the provider abstraction (`T01`), the tenant storage context (`T02`), bucket/object operations (`T03`), and logical organization (`T04`). It does **not** execute multi-provider verification suites (`T06`); it only defines what those suites will verify.

**Relationship to T01 capability manifest**: `T01` (spec `007`) introduced a capability manifest as an introspection surface (T01 FR-004, FR-009). This spec enriches that manifest by (a) defining the **minimum required baseline** that gates provider activation, (b) adding structured constraint metadata per capability, and (c) establishing a validation contract. The manifest structure introduced in T01 is reused, not replaced.

## 1. User Scenarios & Testing

### User Story 1 — Normalized storage error responses across providers (Priority: P1)

A developer, service account, or internal platform service that calls the unified storage API receives provider-agnostic, machine-readable error responses for every storage failure, regardless of which S3-compatible backend is active.

**Why this priority**: Without error normalization, every consumer must understand each provider's native error codes and shapes, which defeats the purpose of the abstraction layer and makes retry, quota, and observability logic provider-dependent.

**Independent Test**: A caller triggers representative storage failures (not found, access denied, quota exceeded, conflict, provider unavailable) and receives responses that follow one canonical error shape with stable error codes, without exposing provider-native error identifiers or internal endpoint details.

**Acceptance Scenarios**:

1. **Given** a caller requests an object that does not exist in an authorized bucket, **When** the provider returns its native not-found error, **Then** the unified API returns a normalized `OBJECT_NOT_FOUND` outcome with a stable error code, human-readable message, and no provider-native error body leakage.
2. **Given** a caller attempts a bucket operation and the provider denies access at the backend level (misconfiguration, credentials revoked), **When** the provider returns its native access-denied error, **Then** the unified API returns a normalized `STORAGE_ACCESS_DENIED` outcome distinguishable from platform-level authorization denial.
3. **Given** a caller uploads an object that would exceed the tenant's storage quota, **When** the platform or provider rejects the request, **Then** the unified API returns a normalized `STORAGE_QUOTA_EXCEEDED` outcome that identifies the violated limit without exposing provider internals.
4. **Given** a caller creates a bucket with a name that already exists within the provider namespace, **When** the provider returns a conflict, **Then** the unified API returns a normalized `BUCKET_ALREADY_EXISTS` outcome.
5. **Given** the active storage provider is temporarily unreachable or returns a transient server error, **When** the caller's request fails, **Then** the unified API returns a normalized `STORAGE_PROVIDER_UNAVAILABLE` outcome with enough retry-hint metadata for the caller to decide whether to retry.

---

### User Story 2 — Minimum common capability contract for supported providers (Priority: P1)

A platform operator or internal onboarding service can verify that any candidate S3-compatible provider satisfies the platform's minimum capability baseline before the provider is activated for tenant storage contexts.

**Why this priority**: Without a declared minimum capability set, the platform cannot guarantee that bucket/object CRUD, logical organization, quota enforcement, and audit context work uniformly across providers, and new provider integrations risk breaking tenant-visible behavior.

**Independent Test**: The platform exposes a capability manifest for the active provider that declares which minimum capabilities are satisfied, and rejects activation of a provider that does not meet the baseline.

**Acceptance Scenarios**:

1. **Given** a supported provider is registered through the provider abstraction (`T01`), **When** the platform evaluates the provider's capability manifest, **Then** it confirms or denies that the provider satisfies every capability in the minimum common baseline.
2. **Given** a provider satisfies the minimum baseline, **When** the tenant storage context is provisioned, **Then** the platform records the provider's declared capabilities alongside the tenant context so downstream services know which optional features are available.
3. **Given** a provider does not satisfy one or more minimum capabilities, **When** the platform attempts to activate it for a tenant, **Then** activation is blocked and the gap is reported with enough detail to identify the missing capabilities.

---

### User Story 3 — Observability-safe error context for audit and correlation (Priority: P2)

A tenant owner, platform operator, or observability pipeline can trace normalized storage errors back to specific operations, tenants, workspaces, and correlation contexts without depending on provider-native error formats.

**Why this priority**: Day-2 operational visibility requires that normalized errors carry enough context for audit trails and incident investigation without forcing operators to decode provider-specific payloads.

**Independent Test**: A normalized storage error event includes tenant, workspace, operation type, correlation ID, normalized error code, and timestamp — all provider-agnostic — and can be matched to the corresponding audit record from `T03`.

**Acceptance Scenarios**:

1. **Given** a storage operation fails and produces a normalized error, **When** the error is recorded through the platform audit/correlation pipeline, **Then** the audit entry includes the normalized error code, operation context (tenant, workspace, bucket, object key if applicable), and correlation metadata.
2. **Given** a series of transient provider failures occur, **When** an operator queries error events, **Then** the events use stable normalized codes and do not require provider-specific decoding to classify failure patterns.
3. **Given** the same logical error occurs on two different providers, **When** both errors are recorded, **Then** they share the same normalized error code and differ only in optional diagnostic detail, not in classification.

### Edge Cases

- **Unmappable provider error**: When a provider returns an error that does not map to any normalized category, the taxonomy must include a bounded `STORAGE_UNKNOWN_ERROR` fallback that captures enough diagnostic context for escalation without exposing raw provider payloads to the caller.
- **Ambiguous access denial**: The taxonomy must distinguish `STORAGE_ACCESS_DENIED` (provider-level credential or policy failure) from the platform's own `FORBIDDEN` (IAM/authorization-level denial), since they require different remediation paths.
- **Malformed provider response**: When a provider returns a success status but the response is malformed or violates the expected contract, the taxonomy must include a `STORAGE_PROVIDER_CONTRACT_VIOLATION` code so the platform can degrade gracefully.
- **Timeout vs. unavailable**: A provider timeout must map to a distinct `STORAGE_PROVIDER_TIMEOUT` code separable from `STORAGE_PROVIDER_UNAVAILABLE`, since timeouts may warrant a retry while sustained unavailability may warrant circuit-breaking.
- **Partial capability support**: When a provider supports a feature partially (e.g., multipart upload with size limits different from the platform baseline), the manifest must represent this as a bounded capability entry with constraint metadata, not a binary yes/no.
- **Capability set drift after activation**: When a provider's capability set changes after activation (e.g., a version upgrade adds or removes features), the manifest must be re-evaluable without requiring tenant storage context re-provisioning.
- **Object size exceeds provider limit**: When a single object exceeds the provider's maximum object size rather than the tenant's quota, the error must map to `STORAGE_OBJECT_TOO_LARGE`, distinct from `STORAGE_QUOTA_EXCEEDED`.

## 2. Requirements

### Functional Requirements

#### Error Taxonomy

- **FR-001**: The system MUST define a canonical normalized error taxonomy for storage operations that maps every provider-native error to exactly one stable platform error code.
- **FR-002**: The normalized error taxonomy MUST include at minimum the following error codes:

  | Code | Meaning | Retryability |
  |---|---|---|
  | `OBJECT_NOT_FOUND` | Requested object does not exist in the target bucket | Not retryable |
  | `BUCKET_NOT_FOUND` | Requested bucket does not exist | Not retryable |
  | `BUCKET_ALREADY_EXISTS` | Bucket creation conflicts with an existing bucket | Not retryable |
  | `OBJECT_ALREADY_EXISTS` | Object write conflicts with a conditional precondition (if-none-match) | Not retryable |
  | `STORAGE_ACCESS_DENIED` | Provider-level credential or policy denial (distinct from platform IAM) | Not retryable |
  | `STORAGE_QUOTA_EXCEEDED` | Tenant or workspace storage quota would be exceeded | Not retryable |
  | `STORAGE_OBJECT_TOO_LARGE` | Single object exceeds the provider's maximum object size | Not retryable |
  | `STORAGE_PROVIDER_UNAVAILABLE` | Provider is unreachable or returned a transient server error | Retryable |
  | `STORAGE_PROVIDER_TIMEOUT` | Provider did not respond within the configured timeout | Conditionally retryable |
  | `STORAGE_PROVIDER_CONTRACT_VIOLATION` | Provider returned a structurally invalid or unexpected response | Not retryable |
  | `STORAGE_INVALID_REQUEST` | Caller's request is malformed or violates storage API rules | Not retryable |
  | `STORAGE_PRECONDITION_FAILED` | Conditional request precondition (if-match / if-none-match) not met | Not retryable |
  | `STORAGE_UNKNOWN_ERROR` | Provider error that cannot be classified into any other category | Conditionally retryable |

- **FR-003**: Each normalized error code MUST carry:
  - a stable machine-readable identifier (the code string),
  - a human-readable message template parameterizable with operation context,
  - an HTTP-status-code recommendation (e.g., 404 for `OBJECT_NOT_FOUND`, 503 for `STORAGE_PROVIDER_UNAVAILABLE`),
  - a retryability hint (`retryable`, `not_retryable`, or `conditionally_retryable`).
- **FR-004**: Normalized error responses MUST NOT expose provider-native error codes, raw provider response bodies, internal endpoint URLs, or credential material to the external caller.
- **FR-005**: Normalized error responses MUST include correlation context sufficient for audit trail linkage:
  - request ID,
  - tenant ID,
  - workspace ID,
  - operation type (e.g., `object.get`, `bucket.create`),
  - bucket name and object key (when applicable).
- **FR-006**: Diagnostic detail from the original provider error MAY be preserved in internal observability/logging channels but MUST NOT appear in the external API response or in tenant-visible audit records.

#### Minimum Capability Baseline

- **FR-007**: The system MUST define a minimum common capability baseline that every supported S3-compatible provider must satisfy before it can be activated for tenant storage contexts. The baseline MUST include at least:
  - Bucket create, delete, and list.
  - Object put, get, delete, and list.
  - Object metadata retrieval (HEAD-equivalent).
  - Content-type preservation on upload and retrieval.
  - ETag or content checksum returned on upload response.
  - Deterministic list pagination (consistent ordering and stable continuation tokens).
  - Conditional request support (`if-match` / `if-none-match`).
- **FR-008**: The system MUST represent provider capabilities as a structured manifest that distinguishes **required baseline capabilities** from **optional extended capabilities**, reusing and enriching the manifest structure introduced by `T01` (spec `007`, FR-004/FR-009).
- **FR-009**: Each capability entry in the manifest MUST support bounded constraint metadata (e.g., maximum object size, maximum key length, maximum parts in multipart, pagination token format) so that partial support is representable.
- **FR-010**: The system MUST validate a provider's capability manifest against the minimum baseline before allowing tenant storage context activation on that provider. This validation integrates as a precondition into the tenant storage context provisioning flow defined by `T02` (spec `008`).
- **FR-011**: When a provider fails minimum capability validation, the system MUST report which specific capabilities are missing or insufficient, including the expected constraint value and the actual value when a capability is partially satisfied.

#### Compatibility and Extensibility

- **FR-012**: The error taxonomy and capability manifest MUST remain compatible with the existing provider abstraction (`T01` / spec `007`), tenant storage context (`T02` / spec `008`), bucket/object CRUD contracts (`T03` / spec `009`), and logical organization model (`T04` / spec `010`) without requiring breaking changes to their published shapes.
- **FR-013**: The error taxonomy MUST be extensible: adding a new normalized error code in the future MUST NOT invalidate existing codes or break consumers that handle the current set. Consumers MUST be able to handle unknown codes by falling back to `STORAGE_UNKNOWN_ERROR` semantics.
- **FR-014**: The capability manifest MUST be re-evaluable at runtime without requiring destruction or re-provisioning of existing tenant storage contexts.
- **FR-015**: Normalized storage errors MUST be compatible with the platform's existing API response envelope (as defined by API Gateway / APISIX conventions) for the HTTP boundary.

### Key Entities

- **Normalized Storage Error**: Canonical error representation containing a stable error code, HTTP status recommendation, human-readable message, retryability hint, and correlation context. Produced by the provider abstraction layer when translating provider-native failures.
- **Storage Capability Manifest**: Structured declaration of a provider's supported capabilities, including required baseline entries and optional extended entries, each with constraint metadata. Bound to a provider profile from `T01`. Enriches the manifest structure introduced by T01 FR-004/FR-009.
- **Minimum Capability Baseline**: Platform-defined subset of the capability manifest that every supported provider must satisfy. Used as an activation gate for tenant storage context provisioning.
- **Capability Entry**: Single capability declaration within a manifest, containing a capability identifier, satisfaction status (satisfied / unsatisfied / partially satisfied), and optional constraint metadata describing limits or partial-support boundaries.

## 3. Security, Governance, Isolation, and Traceability

- Normalized errors are tenant- and workspace-scoped in their correlation context but the taxonomy itself is platform-global.
- Provider-native error details are classified as internal diagnostic material: they may flow to internal logging/observability (Kafka, structured logs) but never to external API responses or tenant-visible audit records.
- The capability manifest for a provider is operational metadata owned by the platform operator; it is not tenant-visible beyond the effect of capability-gated feature availability.
- Error normalization MUST NOT weaken multi-tenant isolation: a normalized error for one tenant's operation MUST NOT leak information about another tenant's storage state, bucket inventory, or object keys.
- Audit records for normalized errors follow the same tenant/workspace/correlation model established by `T03` (spec `009`).
- The minimum capability baseline acts as a governance gate: no provider can serve tenant traffic without passing baseline validation. This is enforced at the `T02` provisioning boundary.
- The `STORAGE_ACCESS_DENIED` error MUST be distinguishable from platform-level `FORBIDDEN` so that security incident triage can separate provider-credential issues from IAM policy misconfigurations.

## 4. Success Criteria

### Measurable Outcomes

- **SC-001**: Every storage operation failure surfaced through the unified API uses a normalized error code from the canonical taxonomy, with zero provider-native error codes or raw provider response bodies visible in the external response.
- **SC-002**: The minimum capability baseline is documented and enforceable: a provider missing any required capability is blocked from tenant activation, with a specific gap report naming each missing or insufficient capability.
- **SC-003**: The same logical failure (e.g., object not found) on two different supported providers produces the same normalized error code and the same HTTP status recommendation.
- **SC-004**: Normalized error events carry enough correlation context (request ID, tenant ID, workspace ID, operation type, bucket, object key) to be joined with bucket/object audit records from `T03` without provider-specific interpretation.
- **SC-005**: The error taxonomy and capability manifest integrate additively with existing provider abstraction (`T01` / spec `007`), tenant context (`T02` / spec `008`), bucket/object contracts (`T03` / spec `009`), and logical organization (`T04` / spec `010`) without breaking their published shapes.
- **SC-006**: A new normalized error code can be added to the taxonomy without invalidating existing codes, changing existing HTTP status mappings, or requiring consumer code changes for previously handled errors.

## 5. Assumptions and Dependencies

- `US-STO-01-T01` (spec `007`) supplies the provider abstraction layer, provider profile structure, and the initial capability manifest surface where the enriched manifest and baseline validation will attach.
- `US-STO-01-T02` (spec `008`) supplies the tenant storage context whose activation is gated by minimum capability validation.
- `US-STO-01-T03` (spec `009`) supplies the bucket/object CRUD contracts and audit model that normalized errors must integrate with.
- `US-STO-01-T04` (spec `010`) supplies the logical organization model; error normalization respects but does not alter the organization hierarchy.
- At least two concrete S3-compatible providers (e.g., MinIO and a second provider such as Ceph RGW, SeaweedFS, or Garage) are anticipated as supported backends, motivating the normalization requirement.
- The platform's existing error response envelope (from API Gateway / APISIX conventions) is the carrier for normalized storage errors at the HTTP boundary.
- The platform's observability backbone (Kafka + structured logging) is available for internal diagnostic detail routing.

## 6. Explicit Out of Scope

- Executing the normalized error taxonomy and capability baseline against multiple live providers as a verification suite (`US-STO-01-T06`).
- Defining presigned URL error flows, multipart upload error recovery, lifecycle policy error semantics, or event-delivery failure normalization beyond what is needed for the base bucket/object operations already defined in `T03`.
- Implementing provider-specific error mapping code or adapter wiring; this spec defines **what** must be normalized and **what capabilities** must exist, not how the mapping is coded.
- Replacing or restructuring the provider abstraction layer itself; the taxonomy and manifest integrate into the existing `T01` structure.
- Defining retry policies, circuit-breaker thresholds, or back-off strategies; the spec provides retryability hints but does not prescribe retry implementation.

## 7. Risks and Open Questions

### Risks

- **Risk**: Provider-native error codes may be ambiguous (e.g., a single HTTP 403 from one provider may mean either access denied or quota exceeded). **Mitigation**: The error mapping layer must use response body inspection, not just HTTP status, to disambiguate. This complexity is expected and contained within the adapter boundary from `T01`.
- **Risk**: The minimum capability baseline may be too strict for some S3-compatible providers that lack features like conditional requests. **Mitigation**: The baseline is intentionally conservative (only features required by T03 bucket/object CRUD). Providers that cannot meet the baseline are excluded by design.

### Open Questions

- **OQ-001**: Should the capability manifest include a version identifier so that changes to the baseline over time are traceable? **Impact**: Low complexity increase. Recommended but does not block specifying or planning the current scope.
- **OQ-002**: Should `STORAGE_OBJECT_TOO_LARGE` carry the provider's actual maximum object size in its metadata so the caller can adjust? **Impact**: Useful for developer experience but may leak provider-specific limits. Can be deferred to implementation decision.
