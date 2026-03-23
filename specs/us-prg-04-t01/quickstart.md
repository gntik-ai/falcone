# Quickstart: US-PRG-04-T01 Testing Strategy Package

Use this package when you need to design or validate tests for multi-tenant, security, data, events, console, or resilience work before the full runtime stack exists.

## Main artifacts

1. `tests/reference/testing-strategy.yaml` — testing pyramid, scenario matrix, taxonomy, console expectations, and API-versioning expectations
2. `tests/reference/reference-dataset.json` — reusable synthetic tenants, users, adapters, events, routes, and resilience cases
3. `scripts/lib/testing-strategy.mjs` — reusable loader/validator helpers
4. `scripts/validate-testing-strategy.mjs` — root validation entry point
5. `tests/adapters/`, `tests/contracts/`, `tests/e2e/console/`, `tests/resilience/`, `tests/unit/` — minimal runnable scaffold tests by layer

## Run the validation chain

From the repository root:

```bash
corepack pnpm lint
corepack pnpm test
```

Or run the testing-strategy checks directly:

```bash
node ./scripts/validate-testing-strategy.mjs
node --test tests/unit/testing-strategy.test.mjs
node --test tests/adapters/reference-fixtures.test.mjs
node --test tests/contracts/testing-strategy.contract.test.mjs
node --test tests/e2e/console/console-test-scaffold.test.mjs
node --test tests/resilience/resilience-scaffold.test.mjs
```

## Expected extension workflow for later tasks

1. Reuse fixture identifiers from `reference-dataset.json` whenever possible.
2. Add new matrix scenarios instead of creating undocumented one-off test cases.
3. Preserve the existing layer names (`unit`, `adapter_integration`, `api_contract`, `console_e2e`, `resilience`).
4. Keep console role/state identifiers stable unless the permission model formally changes.
5. Update the strategy validator if the OpenAPI versioning model or required domains evolve.

## Current baseline expectations

- Business API routes stay under `/v1/`.
- Non-health API operations require `X-API-Version`.
- The current API-version fixture is `2026-03-23`.
- Console coverage is state/permission oriented today, not browser-framework specific.
- Resilience coverage starts with timeout, replay/idempotency, and tenant-safe recovery scenarios.
