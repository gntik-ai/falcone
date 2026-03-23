# Implementation Plan: Integrated Testing Strategy and Reference Dataset

**Branch**: `feature/us-prg-04` | **Date**: 2026-03-23 | **Spec**: `specs/us-prg-04-t01/spec.md`  
**Input**: Feature specification from `/specs/us-prg-04-t01/spec.md`

## Summary

Create a repository-native testing strategy package that defines the testing pyramid, cross-domain scenario matrix, synthetic reference dataset, UI-state/permission expectations, API contract alignment, and minimal runnable scaffolding for each test layer. Keep the increment lightweight and executable so sibling tasks can extend it for real control-plane, adapter, multi-tenant, security, data, event, and console behavior.

## Technical Context

**Language/Version**: Node.js 20+ compatible scripts/tests, Markdown, YAML, JSON  
**Primary Dependencies**: Node built-in `node:test`, existing `yaml` parser, existing OpenAPI validation assets  
**Storage**: repository-only specification and fixture artifacts; no external systems  
**Testing**: root validation script plus lightweight scaffold tests for unit, adapter integration, API contract, console E2E, and resilience layers  
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners  
**Project Type**: governance + scaffold increment for a monorepo platform  
**Performance Goals**: validation remains fast, deterministic, and runnable without live services or browsers  
**Constraints**: preserve room for T02-T06, avoid selecting final runtime/browser/chaos tooling, reuse the existing control-plane OpenAPI artifact, keep fixtures synthetic and non-secret  
**Scale/Scope**: one strategy package, one reference dataset, one validator, one helper module, and one lightweight scaffold test per test layer

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — documentation, scripts, and tests remain in existing repository areas.
- **Incremental Delivery First**: PASS — the work adds structure and executable scaffolding, not speculative runtime implementation.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment/runtime assumptions are introduced.
- **Quality Gates at the Root**: PASS — root scripts validate the new package.
- **Documentation as Part of the Change**: PASS — spec, plan, research, quickstart, tasks, README updates, and task notes are included.

## Project Structure

### Strategy and planning package

```text
specs/us-prg-04-t01/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
└── tasks.md

docs/tasks/
└── us-prg-04-t01.md
```

### Reusable test-strategy assets

```text
scripts/
├── lib/testing-strategy.mjs
└── validate-testing-strategy.mjs

tests/
├── adapters/
│   ├── README.md
│   └── reference-fixtures.test.mjs
├── contracts/
│   └── testing-strategy.contract.test.mjs
├── e2e/
│   ├── README.md
│   └── console/
│       ├── README.md
│       └── console-test-scaffold.test.mjs
├── reference/
│   ├── README.md
│   ├── reference-dataset.json
│   └── testing-strategy.yaml
├── resilience/
│   ├── README.md
│   └── resilience-scaffold.test.mjs
└── unit/
    └── testing-strategy.test.mjs
```

**Structure Decision**: Keep the testing strategy in repository-native YAML/JSON/Markdown plus Node helpers so future tasks can extend the same package with real adapters, browser tooling, synthetic environments, and fault-injection harnesses.

## Test Pyramid Definition

1. **Unit** — validates pure policies, fixture builders, permission reducers, and classification logic with zero infrastructure.
2. **Adapter Integration** — validates adapter-to-stub behavior, payload mappings, tenant context propagation, retry classification, and durable fixture usage.
3. **API Contract** — validates OpenAPI-aligned URI/versioning/error expectations and future consumer/provider contract rules.
4. **Console E2E** — validates actor-visible navigation, state transitions, and permission boundaries through the user-facing console workflow layer.
5. **Resilience** — validates degraded behavior, retries, idempotency, tenant-safe recovery, and operator visibility under failures.

## Cross-Domain Matrix Strategy

The matrix should map each scenario to:

- one test layer
- one primary domain (`multi_tenant`, `security`, `data`, `events`, `console`)
- a reusable fixture set from the synthetic dataset
- a taxonomy category (`positive`, `negative`, `permission`, `contract`, `resilience`, `recovery`)
- one expected result statement

This keeps later tasks traceable without forcing every scenario into a heavyweight automation stack immediately.

## Reference Dataset Strategy

Provide a compact synthetic dataset that future tests can reuse across layers:

- tenants in both `shared_schema` and `dedicated_database` placements
- actor fixtures for platform and tenant roles
- reusable workspaces/routes for console expectations
- adapter fixtures for HTTP/object-storage/event integrations
- current API-version fixture aligned with the OpenAPI contract
- resilience fixtures for timeout, replay, and placement-failover style scenarios

## UI States and Permissions Expectations

Document console expectations for:

- `unauthenticated`
- `platform_admin`
- `tenant_admin`
- `tenant_operator`
- `auditor`

Each state should record visible sections, blocked sections, and allowed actions so later console stories inherit explicit permission boundaries rather than inferring them from implementation.

## API Contract and Versioning Expectations

Align the strategy package with the existing control-plane contract by recording:

- `/v1/` URI prefix for business routes
- required `X-API-Version` header for non-health operations
- current version value `2026-03-23`
- explicit error-contract expectations
- rule that breaking changes require versioning intent instead of silent drift

## Validation Strategy

1. Add a reusable helper module that loads and validates the strategy YAML and reference dataset.
2. Add a root validation script that fails if required pyramid levels, domains, console states, or fixture references are missing.
3. Add one lightweight scaffold test per test layer:
   - unit: helper behavior and actual package consistency
   - adapter integration: fixture anchoring for adapter scenarios
   - API contract: alignment between strategy expectations and the actual OpenAPI document
   - console E2E: actor/state coverage and permission expectation scaffolding
   - resilience: failure-mode coverage and resilience fixture anchoring
4. Wire the validator into root scripts so `pnpm lint` and `pnpm test` exercise the package automatically.
5. Update lightweight documentation so future tasks can extend rather than replace the package.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Add a dedicated strategy validator | The package must stay executable and auditable from the root | Markdown-only guidance would drift without fast automated checks |
| Add scaffold tests for layers without live runtimes | Future stories need a runnable extension point now | Empty folders would not prove that the test model is internally consistent |
| Keep fixtures synthetic and repository-local | Current task is about strategy, not live integration environments | Introducing Playwright, contract harnesses, or chaos tooling now would over-commit sibling tasks |
