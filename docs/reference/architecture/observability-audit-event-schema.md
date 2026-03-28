# Observability Audit Event Schema (`US-OBS-02-T02`)

`US-OBS-02-T01` established the shared audit pipeline for IAM, PostgreSQL, MongoDB, Kafka, OpenWhisk, storage, quota/metering, and the tenant/workspace control plane.

`US-OBS-02-T02` adds the next required layer: the **canonical audit event schema** every subsystem must target when emitting administrative audit records.

This document is the human-readable companion to:

- `services/internal-contracts/src/observability-audit-event-schema.json`

It explains the common event envelope, the normalized vocabularies, and the intentional boundaries of this increment.

---

## Why this baseline exists

The pipeline contract alone is not enough. A durable audit stream still becomes inconsistent if each subsystem emits different field names or incompatible event shapes.

This baseline establishes a single contract for:

- who acted,
- when the action was recorded,
- which tenant/workspace/platform scope was affected,
- which subsystem resource was targeted,
- which normalized action category occurred,
- what the result was,
- which correlation id ties the action to the broader request path,
- and where the action originated.

Later tasks use this baseline as input:

- `US-OBS-02-T03` builds filtered query surfaces.
- `US-OBS-02-T04` builds export and masking behavior.
- `US-OBS-02-T05` builds cross-system correlation and traceability.
- `US-OBS-02-T06` builds end-to-end verification.

---

## Canonical event envelope

Every audit record now shares the same top-level field inventory:

- `event_id`
- `event_timestamp`
- `actor`
- `scope`
- `resource`
- `action`
- `result`
- `correlation_id`
- `origin`
- `detail`

The first nine fields are the stable canonical envelope.

`detail` is the bounded subsystem-specific extension area. Subsystems may place extra context there, but they may not move, rename, or replace the canonical envelope fields.

---

## Event identity and timestamp

The baseline requires every record to carry:

- a stable `event_id`,
- an `event_timestamp` in normalized UTC form,
- and the schema version used to shape the record.

The contract treats audit records as immutable once recorded.

---

## Actor normalization

The `actor` section exists so every event is attributable, even when the initiating actor differs by subsystem.

Required actor fields:

- `actor_id`
- `actor_type`

Optional actor fields:

- `display_name`
- `service_account_id`
- `effective_role_scope`

Bounded actor types:

- `platform_user`
- `tenant_user`
- `workspace_user`
- `service_account`
- `system`
- `provider_adapter`

This keeps actor attribution aligned with the authorization model without redefining the authorization contracts in this increment.

---

## Scope rules and multi-tenancy

The schema explicitly distinguishes three scope modes:

- `tenant`
- `tenant_workspace`
- `platform`

Rules:

- tenant-scoped events require `tenant_id`
- workspace-scoped events require both `tenant_id` and `workspace_id`
- platform-scoped events must not fabricate tenant or workspace identifiers

This preserves the tenant-isolation rules introduced by `US-OBS-02-T01`.

---

## Resource normalization

The `resource` section identifies the affected managed object.

Required fields:

- `subsystem_id`
- `resource_type`

Conditionally required field:

- `resource_id`

Optional fields:

- `resource_display_name`
- `parent_resource_id`

The supported subsystem ids match the T01 audit pipeline roster:

- `iam`
- `postgresql`
- `mongodb`
- `kafka`
- `openwhisk`
- `storage`
- `quota_metering`
- `tenant_control_plane`

---

## Action normalization

The `action` section gives every event a normalized action identity and category.

Required fields:

- `action_id`
- `category`

Optional fields:

- `change_type`
- `requested_operation`

The category vocabulary is intentionally aligned with the audit-pipeline contract:

- `resource_creation`
- `resource_deletion`
- `configuration_change`
- `access_control_modification`
- `privilege_escalation`
- `quota_adjustment`

This prevents later query/export work from needing to reverse-engineer subsystem-specific action strings.

---

## Result normalization

The `result` section standardizes administrative outcomes.

Required field:

- `outcome`

Optional fields:

- `error_code`
- `failure_reason`
- `policy_basis`

Bounded outcomes:

- `succeeded`
- `failed`
- `denied`
- `partial`
- `accepted`

This keeps outcome semantics explicit without implementing later query, reporting, or export behavior here.

---

## Origin and traceability baseline

The schema requires every event to carry:

- `correlation_id`
- an `origin` section

Required origin fields:

- `origin_surface`
- `emitting_service`

Optional origin fields:

- `execution_mode`
- `api_family`

Bounded origin surfaces:

- `control_api`
- `console_backend`
- `internal_reconciler`
- `provider_adapter`
- `bootstrap_job`
- `scheduled_operation`

This is the minimum traceability baseline for future correlation work. `US-OBS-02-T05` will later define how related records are connected end to end.

---

## Detail extension boundary

The schema intentionally reserves one bounded extension area: `detail`.

Allowed use:

- subsystem-specific context that does not fit the common envelope

Disallowed use:

- redefining canonical envelope fields
- replacing `correlation_id`
- replacing actor or scope fields

This boundary lets later tasks classify, mask, or export detail fields without breaking the common event envelope.

---

## Validation and discoverability

Primary validation entry point:

```bash
npm run validate:observability-audit-event-schema
```

The validation helper checks:

- source-version alignment with the audit-pipeline contract and authorization model
- required top-level fields
- required actor, scope, result, and origin definitions
- category coverage against the T01 pipeline contract
- preservation of the T03 boundary in governance metadata

---

## Scope boundary for this increment

This increment defines the **event schema baseline only**.

It does **not** add:

- query/filter APIs
- export bundle formats
- masking execution rules
- correlation chains
- runtime emitters or storage implementations
- UI behavior

Those remain in later `US-OBS-02` tasks.
