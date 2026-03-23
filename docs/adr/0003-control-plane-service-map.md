# ADR 0003: Control-plane service map and internal contract boundaries

- **Status**: Accepted
- **Date**: 2026-03-23
- **Decision owners**: Architecture / platform bootstrap
- **Related task**: `US-ARC-01-T01`

## Context

The platform is a multi-tenant BaaS with a public control-plane API plus downstream provisioning work across identity, relational data, document data, messaging, functions, and object storage. Earlier tasks established the monorepo, the baseline public OpenAPI contract, and the PostgreSQL tenant-isolation decision, but the internal service boundaries of the control plane were still implicit.

Without a service-map baseline, later tasks would risk:

- coupling public API handlers directly to provider integrations
- mixing orchestration policy with provider SDK details
- treating auditability as incidental logging instead of a first-class boundary
- introducing circular dependencies between control, provisioning, and adapter code

## Decision

Adopt the following internal split for the BaaS control plane:

1. **`control_api`** in `apps/control-plane`
   - Owns the public REST contract, API-version enforcement, request validation, authorization context, and translation into internal command envelopes.
2. **`provisioning_orchestrator`** in `services/provisioning-orchestrator`
   - Owns orchestration intent, idempotent provisioning-run correlation, step sequencing, and provider call coordination.
3. **`audit_module`** in `services/audit`
   - Owns append-only evidence capture for accepted commands, provisioning state changes, and provider outcomes.
4. **`services/adapters`**
   - Owns provider-facing ports and future provider-specific implementations for Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, and storage.
5. **`services/internal-contracts`**
   - Owns the machine-readable source of truth for service boundaries and internal contract envelopes only.

## Dependency rules

Allowed baseline dependency directions:

- `control_api` -> `provisioning_orchestrator`
- `control_api` -> `audit_module`
- `provisioning_orchestrator` -> `audit_module`
- `provisioning_orchestrator` -> adapter ports
- `audit_module` -> selected adapter ports needed for durable evidence persistence

Disallowed baseline dependency directions:

- `control_api` -> provider adapters directly
- provider adapters -> control or orchestration modules
- `audit_module` -> `control_api`
- circular service-to-service dependencies

## Contract baseline

The machine-readable contract catalog must define, at minimum:

- `control_api_command`
- `provisioning_request`
- `provisioning_result`
- `adapter_call`
- `adapter_result`
- `audit_record`

The baseline expectations are:

- non-read control/provisioning contracts carry a stable `idempotency_key`
- each contract declares a `contract_version`
- provider results classify failures as retryable vs terminal
- audit records are append-only and include actor, scope, action, outcome, correlation, and timestamp metadata

## Consequences

### Positive

- Establishes clear package seams for later tasks.
- Makes provider isolation explicit before SDK/runtime code exists.
- Gives auditability a first-class architectural boundary.
- Enables automated validation of dependency direction and contract presence.

### Negative / trade-offs

- Adds new workspace packages before they contain runtime behavior.
- Introduces another repository artifact to keep updated when boundaries evolve.
- Leaves some implementation choices intentionally unresolved until later tasks.

## Deferred work

This ADR does not choose or implement:

- queue/worker technology
- provider SDKs or credentials
- provisioning persistence tables
- audit storage/query schema
- retry scheduling algorithms
- deployment/runtime topology

Those choices belong to later tasks and must extend the service-map baseline rather than bypass it.

## Compliance notes

- Future changes to boundary direction or contract identity should update the source-of-truth package in `services/internal-contracts` and document the change in a new ADR or task package.
- Breaking internal contract changes require an explicit versioning/migration plan instead of silent drift.
