# Research Notes: US-PRG-04-T01

## Decision: use repository-native strategy artifacts first

**Reasoning**

- The repo already follows an incremental bootstrap approach.
- The task asks for what/why plus reusable scaffolding, not final framework selection.
- YAML/JSON + Node validation provides a fast, auditable baseline that CI can run immediately.

**Expected effect**

- Future tasks can add Playwright, provider mocks, consumer-driven contract tooling, or failure-injection frameworks without discarding the strategy package.

## Decision: keep the cross-domain matrix independent from any one service

**Reasoning**

- The project spans control plane, adapters, console, and operational concerns.
- A service-local matrix would make multi-tenant, security, data, and event coverage fragment early.

**Expected effect**

- The matrix should use shared fixture identifiers and domain tags so later app/service packages can reference the same scenarios.

## Decision: treat console expectations as role/state documentation plus scaffold tests

**Reasoning**

- The console runtime is not implemented yet.
- The permission model still needs to be explicit for later UI stories.

**Expected effect**

- Current E2E scaffolding validates state/permission expectations, not live browser behavior.
- Later tasks should preserve the same actor/state identifiers when a real console stack is added.

## Decision: align the strategy package with the current OpenAPI artifact

**Reasoning**

- The repository already introduced a control-plane contract and versioning expectations.
- The testing strategy must not drift from the real contract baseline.

**Expected effect**

- The validator and contract scaffold tests should compare the strategy package against the current OpenAPI version header and URI prefix.

## Decision: add resilience coverage as data-backed scaffolding

**Reasoning**

- Resilience requirements matter early for multi-tenant systems.
- Real chaos tooling would be premature for T01.

**Expected effect**

- The package records timeout, replay/idempotency, and tenant-safe recovery scenarios now.
- Later tasks can bind those scenarios to queues, adapters, browsers, or platform failure injectors.

## Rejected alternatives

### Introduce Playwright now

Rejected because the console runtime does not exist yet and the task should remain strategy-first.

### Introduce Schemathesis/Dredd or similar contract tooling now

Rejected because the current repository only needs alignment with the existing OpenAPI artifact and lightweight contract scaffolding.

### Add Dockerized integration environments now

Rejected because adapter/runtime implementations are still deferred to sibling tasks.
