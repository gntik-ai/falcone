## Context

Falcone has no durable workflow engine. The flows epic (#355) proposes Temporal as the foundation. Before any production code is written, two architectural assumptions must be tested: (a) that a generic YAML DSL interpreter workflow gives deterministic, durable execution without bespoke checkpointing, and (b) that one of two tenancy models is viable at the expected tenant scale. This change owns only the ADR record and the two spikes; it does not ship production interpreter code, Helm resources, or API routes.

Current state: no `@temporalio/*` packages anywhere in the repository (verified by grep across `apps/` and `services/`). The control-plane runtime is Node 22 ESM (`apps/control-plane/Dockerfile`: `FROM node:22-alpine`; `apps/control-plane/package.json`: `"type":"module"`). All services use `.mjs` modules with `"type":"module"`. Tenant identity is carried as `{ tenantId, workspaceId }` resolved in `apps/control-plane/src/runtime/server.mjs::resolveIdentity` and enforced at the data layer via `services/adapters/src/tenant-rls-context.mjs::withTenantRlsContext`.

## Goals / Non-Goals

**Goals:**
- Record the Temporal adoption decision as an ADR in the existing ADR file, covering all seven required fields from issue #356.
- Spike A: validate that a Temporal TypeScript SDK workflow acting as a generic DSL interpreter survives a worker kill-and-restart and resumes correctly; choose the expression engine (CEL vs JSONata); validate the definition-passing strategy.
- Spike B: prototype both namespace-per-tenant and shared-namespace+search-attributes models; produce a measured comparison table; choose the tenancy model; validate PostgreSQL SQL visibility with custom search attributes.

**Non-Goals:**
- Production-quality interpreter (owned by `add-flows-dsl-interpreter-worker`).
- Helm chart for Temporal (owned by `add-flows-temporal-helm`).
- Control-plane API routes for flows (owned by `add-flows-control-plane-api`).
- Tenancy enforcement middleware (owned by `add-flows-tenancy-isolation-limits`).
- Any console UI work.

## Decisions

### D1 — Run spikes against a local Temporal dev server

Rationale: `temporal server start-dev` (or a `docker compose` service alongside `tests/env/`) provides a full Temporal server with an in-memory SQLite database, sufficient for durability proofs and namespace/visibility experiments. It avoids cloud dependencies and keeps the spike self-contained. The production PostgreSQL persistence store is validated in Spike B's visibility sub-experiment by pointing the dev server at the existing `tests/env` Postgres instance with the Temporal schema applied.

Alternatives considered:
- Temporal Cloud: requires account setup, adds network latency, and is not reproducible in CI without credentials.
- Helm-deployed Temporal cluster: premature; the Helm change is a sibling ticket.

### D2 — TypeScript SDK for both spikes

Rationale: All `apps/` and `services/` are Node 22 ESM (`.mjs` throughout; `"type":"module"` in every `package.json`). The TypeScript SDK (`@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/client`) is the official Temporal SDK for this stack. No other backend language exists in the repository; introducing one for a spike would distort the tenancy-model measurements.

### D3 — Definition-passing strategy: definition as workflow input (default path)

Rationale: Workflow input is recorded in Temporal history at schedule time. An interpreter workflow that receives the full YAML definition as input is therefore deterministic on replay without an external lookup. The alternative — loading by `flowId`+`version` via an activity — is also history-safe (activity results are recorded) but adds a read round-trip per replay. Spike A will prototype the input-passing path and document the history size implications.

### D4 — Expression engine comparison framework

Both CEL and JSONata are evaluated on three axes:

| Axis | CEL | JSONata |
|---|---|---|
| Determinism in Temporal sandbox | Stateless pure evaluator; no I/O | Stateless; no I/O; extension functions must be registered explicitly |
| Node 22 ESM bundle size | `cel-js` ~180 kB minified | `jsonata` ~120 kB minified |
| Embedding complexity | Pure JS, no WASM; straightforward ESM import | Pure JS; straightforward ESM import |

Spike A will run both in the workflow sandbox (no Node built-ins, no timers) and record which evaluates correctly in the Temporal V8 isolate. The ADR records the chosen engine.

### D5 — Tenancy model comparison framework

The two models are evaluated on four measured dimensions:

| Dimension | Namespace-per-tenant | Shared namespace + search attributes |
|---|---|---|
| Isolation boundary | Hard (separate namespace, history, visibility) | Soft (search-attribute filter in API layer only) |
| Poller count (N tenants, 1 worker type) | N × pollers | 1 × pollers |
| gRPC connections (N tenants) | N × connections | 1 connection |
| Operational complexity | Namespace provisioning per tenant, lazy-worker logic | Single namespace; simple worker pool |

Spike B measures poller and connection counts empirically at N = {1, 5, 20} tenants using the Temporal SDK's connection and worker APIs. Results populate the comparison table. The chosen model is recorded in the ADR.

### D6 — Spike code location

Spike code is placed under `spikes/add-flows-adr-temporal-spikes/` (repository root). This directory is explicitly not imported by any production path and is documented with a header comment marking it as ephemeral. It is not added to the Helm chart or to `apps/` or `services/`.

## Risks / Trade-offs

- [Risk] Temporal dev server SQLite visibility store may not faithfully represent PostgreSQL SQL visibility behavior for custom search attributes. → Mitigation: Spike B sub-experiment connects the dev server to the `tests/env` Postgres instance using the Temporal SQL persistence plugin; if that is impractical, the sub-experiment documents the gap and the ADR notes it as a remaining validation item for the Helm spike.
- [Risk] The Temporal V8 sandbox (workflow isolate) may reject CEL or JSONata due to use of restricted built-ins. → Mitigation: Both engines are tested inside a real Temporal workflow function early in Spike A; if both fail, the ADR records a custom mini-evaluator as the fallback.
- [Risk] Namespace-per-tenant may be impractical above a small tenant count due to connection overhead. → Mitigation: Spike B measures up to N=20 and documents the breakeven point; the ADR states the upper bound explicitly.

## Open Questions

- Q1: Does the existing `tests/env/docker-compose.yml` have a Postgres service that can be reused for Temporal SQL persistence in Spike B, or must a dedicated Temporal schema be applied? (Confirm before running Spike B.)
- Q2: Does `temporal server start-dev` on Node 22 Linux work via `npx @temporalio/testing`? Or is the binary installed separately? (Confirm by running the dev server in CI as part of spike setup.)
