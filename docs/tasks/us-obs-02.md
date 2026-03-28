# US-OBS-02 — Auditoría transversal, consulta, exportación, enmascarado y correlación

## Scope delivered in `US-OBS-02-T01`

This increment establishes the **common audit pipeline contract baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-pipeline.json` as the machine-readable source of truth for subsystem enrollment, event-category coverage, Kafka transport topology, at-least-once delivery, tenant isolation, resilience rules, health signals, and pipeline self-audit requirements
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit pipeline contract
- `scripts/lib/observability-audit-pipeline.mjs` and `scripts/validate-observability-audit-pipeline.mjs` for deterministic validation of the contract and its alignment with the existing observability baseline
- `docs/reference/architecture/observability-audit-pipeline.md` as the human-readable architecture guide for the audit pipeline baseline
- `docs/reference/architecture/README.md` index updates so the new audit guidance is discoverable

## Main decisions in `US-OBS-02-T01`

### One common audit pipeline precedes downstream audit features

The platform now defines one shared audit pipeline contract for administrative events emitted by:

- IAM (Keycloak)
- PostgreSQL
- MongoDB
- Kafka
- OpenWhisk
- S3-compatible storage
- the quota and metering layer
- the tenant and workspace control plane

This common baseline must be consumed by later work instead of letting each downstream task infer its own subsystem coverage or delivery guarantees.

### Kafka is the transport backbone and delivery is at least once

The contract explicitly fixes the audit path as:

```text
subsystem emitter → Kafka audit transport → durable audit store
```

The baseline also fixes tenant partitioning, platform-scoped routing, and the expectation that downstream consumers remain idempotent under at-least-once delivery.

### Audit health is part of observability, not a side concern

The audit pipeline defines required health signals for:

- emission freshness
- transport health
- storage health

These signals reuse the established observability label model and health vocabulary from `US-OBS-01` so missing or delayed audit coverage becomes operationally visible.

### Tenant isolation is enforced by the pipeline contract itself

Tenant-scoped audit events require `tenant_id`, may include `workspace_id` when safely attributable, and must never leak into other-tenant or platform-only views.

Platform-scoped events and unattributed events remain explicitly separate from tenant partitions.

## Validation for `US-OBS-02-T01`

Primary validation entry point:

```bash
npm run validate:observability-audit-pipeline
```

## Downstream dependency note

`US-OBS-02-T01` is the foundation for the remaining tasks in this story.

Later increments must build on this contract rather than redefining the pipeline:

- `US-OBS-02-T02` — detailed audit event schema
- `US-OBS-02-T03` — query and filter surfaces
- `US-OBS-02-T04` — export, masking, and sensitive-event handling
- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Scope delivered in `US-OBS-02-T02`

This increment establishes the **canonical audit event schema baseline** for the platform.

Delivered artifacts:

- `services/internal-contracts/src/observability-audit-event-schema.json` as the machine-readable source of truth for the canonical event envelope, including actor, scope, resource, action, result, correlation, origin, and bounded detail-extension rules
- `services/internal-contracts/src/index.mjs` shared readers and accessors for the audit event schema contract
- `scripts/lib/observability-audit-event-schema.mjs` and `scripts/validate-observability-audit-event-schema.mjs` for deterministic validation of the schema and its alignment with the audit-pipeline and authorization-model baselines
- `docs/reference/architecture/observability-audit-event-schema.md` as the human-readable architecture guide for the canonical event schema baseline
- `docs/reference/architecture/README.md` index updates so the new schema guidance is discoverable

## Main decisions in `US-OBS-02-T02`

### One canonical audit envelope now exists for every subsystem

Every administrative audit record must now share the same top-level structure:

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

This prevents downstream tasks from inventing subsystem-specific audit envelopes.

### Scope and origin are standardized before query and correlation work

The schema explicitly normalizes:

- tenant/workspace/platform scope modes
- actor identity requirements
- action categories aligned to the T01 pipeline contract
- bounded result outcomes
- origin surfaces for control API, console backend, reconciler, provider-adapter, bootstrap, and scheduled flows

This gives later query, export, masking, and correlation work a stable contract to consume.

### `detail` is reserved for subsystem-specific fields without weakening the envelope

Subsystems may attach extra context under `detail`, but they may not move or redefine the canonical envelope fields there.

That keeps the common audit surface stable while still allowing future subsystem-specific enrichment.

## Validation for `US-OBS-02-T02`

Primary validation entry point:

```bash
npm run validate:observability-audit-event-schema
```

## Downstream dependency note for `US-OBS-02-T02`

This increment does **not** add query/filter APIs, export formats, masking execution, or correlation workflows.

Those remain downstream work:

- `US-OBS-02-T03` — query and filter surfaces
- `US-OBS-02-T04` — export, masking, and sensitive-event handling
- `US-OBS-02-T05` — cross-system correlation and traceability
- `US-OBS-02-T06` — end-to-end verification and data-protection testing

## Residual implementation note

This increment does **not** implement runtime emitters, Kafka topic provisioning, consumers,
storage adapters, query APIs, export logic, masking execution, or correlation behavior.
It only establishes the bounded contract, validation, and documentation foundation required before
those later tasks can proceed safely.
