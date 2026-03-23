# Implementation Plan: BaaS Internal Service Map and Contract Baseline

**Branch**: `feature/us-arc-01` | **Date**: 2026-03-23 | **Spec**: `specs/us-arc-01-t01/spec.md`  
**Input**: Feature specification from `/specs/us-arc-01-t01/spec.md`

## Summary

Define the internal control-plane service map for the BaaS and capture the minimum shared contract baseline needed before runtime implementation. This increment will record the control API, provisioning orchestrator, audit module, and required adapter ports for Keycloak/PostgreSQL/MongoDB/Kafka/OpenWhisk/storage, then add lightweight workspace scaffolding and repository validation so later tasks can implement behavior without circular coupling.

## Technical Context

**Language/Version**: Markdown, JSON, JavaScript (Node.js 25, ESM)  
**Primary Dependencies**: repository-native docs, Node standard library (`fs`, `path`), existing root `yaml` dependency for validation helpers  
**Storage**: architecture metadata only; no live databases or queues introduced  
**Testing**: root validation script plus lightweight unit, adapter, and contract tests  
**Target Platform**: Linux developer/CI environment for repository validation  
**Project Type**: monorepo architecture/governance increment with minimal scaffolding  
**Performance Goals**: N/A for runtime; artifacts must remain fast to validate and easy to audit  
**Constraints**: preserve room for T02-T06, avoid provider/runtime/framework lock-in, keep boundaries explicit, keep changes reversible and auditable  
**Scale/Scope**: one spec package, one ADR, one machine-readable service-map/contract catalog, a small validator, and lightweight workspace scaffolding

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — runtime-free artifacts stay within `specs/`, `docs/`, `scripts/`, `tests/`, `apps/`, and `services/` using explicit boundaries.
- **Incremental Delivery First**: PASS — this task defines architecture and package seams without implementing providers, queues, or persistence.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment/runtime changes are introduced.
- **Quality Gates at the Root**: PASS — a new root validator and tests will keep the service-map package auditable in CI.
- **Documentation as Part of the Change**: PASS — the increment is documentation-first and produces traceable architectural artifacts.

## Project Structure

### Documentation and planning package

```text
specs/us-arc-01-t01/
├── spec.md
├── plan.md
├── research.md
├── service-map.md
├── quickstart.md
└── tasks.md
```

### Repository artifacts

```text
docs/
├── adr/
│   └── 0003-control-plane-service-map.md
├── reference/
│   └── architecture/
│       └── README.md
└── tasks/
    └── us-arc-01-t01.md

services/
├── internal-contracts/
│   ├── package.json
│   └── src/
│       ├── index.mjs
│       └── internal-service-map.json
├── provisioning-orchestrator/
│   ├── package.json
│   └── src/
│       ├── README.md
│       └── contract-boundary.mjs
└── audit/
    ├── package.json
    └── src/
        ├── README.md
        └── contract-boundary.mjs

apps/control-plane/src/
└── internal-service-map.mjs

services/adapters/src/
└── provider-catalog.mjs

scripts/
├── lib/
│   └── service-map.mjs
└── validate-service-map.mjs

tests/
├── unit/
│   └── service-map.test.mjs
├── adapters/
│   └── provider-catalog.test.mjs
└── contracts/
    └── internal-service-map.contract.test.mjs
```

**Structure Decision**: Keep the source of truth in a lightweight `services/internal-contracts` package that stores the machine-readable service map and shared contract catalog. Other workspaces only consume slices from that package, which prevents circular coupling while keeping later runtime choices open.

## Phase 0 Research Focus

1. Determine the narrowest boundary split that separates public API handling, orchestration, provider integration, and audit evidence.
2. Define the minimum contract envelopes needed to make idempotency, versioning, and error classification explicit before runtime code exists.
3. Ensure the structure is extendable for later tasks without forcing a queue, persistence model, or provider SDK today.

## Phase 1 Design Outputs

1. Feature spec, implementation plan, research notes, service-map notes, quickstart, and tasks package.
2. ADR recording the chosen service split and dependency rules.
3. Machine-readable service map and internal contract catalog under `services/internal-contracts`.
4. Package entry points for control-plane, adapters, provisioning-orchestrator, and audit modules that expose their contract boundaries.
5. Root validator and lightweight tests covering service presence, adapter coverage, dependency direction, contract invariants, and append-only audit behavior.

## Architecture Decisions

### Service boundaries

1. **Control API** — owns the public HTTP contract, request validation, authorization context, API-version enforcement, and translation into internal commands.
2. **Provisioning Orchestrator** — owns long-running provisioning intent, step sequencing, idempotent run correlation, and provider call coordination.
3. **Audit Module** — owns append-only evidence capture for accepted commands, provisioning state changes, and provider outcomes.
4. **Adapters Package** — owns provider-specific port definitions and future provider clients for Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, and storage.
5. **Internal Contracts Package** — owns machine-readable shared contract metadata only; it contains no provider/runtime logic.

### Contract strategy

- Use a single contract version marker (`2026-03-23`) for this baseline increment.
- Treat `control_api_command` and `provisioning_request` as idempotent command envelopes with a required `idempotency_key`.
- Treat `adapter_call`/`adapter_result` as provider-agnostic envelopes that classify failures as retryable or terminal.
- Treat `audit_record` as append-only evidence with required actor, scope, action, outcome, correlation, and timestamp metadata.
- Keep public REST versioning aligned with the current `/v1/` control-plane contract while allowing internal contract versioning to evolve deliberately later.

### Validation strategy

- Add `scripts/lib/service-map.mjs` to read and validate the machine-readable service map.
- Add `scripts/validate-service-map.mjs` and wire it into root `validate:repo` / `lint` flow.
- Add tests for:
  - unit validation of the service-map package
  - adapter catalog coverage for all required provider ports
  - contract-level invariants for dependency direction, idempotency, and audit immutability

## Implementation Strategy

1. Author `spec.md` from the task's specify prompt.
2. Author `plan.md` and supporting `research.md`, `service-map.md`, `quickstart.md`, and `tasks.md`.
3. Add the task breakdown note under `docs/tasks/`.
4. Record the architecture decision in a new ADR.
5. Implement the machine-readable service map and internal contract package.
6. Add package scaffolding for provisioning, audit, control-plane boundary access, and adapter catalog access.
7. Add validation/test wiring and update repository documentation.
8. Run relevant root validation commands and capture outcomes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New workspace packages (`internal-contracts`, `provisioning-orchestrator`, `audit`) | Future tasks need explicit boundaries in the monorepo, not only prose docs | Keeping everything in Markdown would not provide executable scaffolding or a machine-checkable contract source |
| Machine-readable contract catalog JSON | Validation/tests must assert boundary rules without fragile markdown parsing | Markdown-only descriptions would drift and be harder to audit automatically |
| Cross-package boundary helper modules | Future tasks need stable import points without direct provider/runtime coupling | Leaving only empty READMEs would not establish a practical extension path |
