# Change: fix-736-async-operations-schema

## Why

Issue #736 is a confirmed control-plane boot schema gap for the web console operations
surface. The kind control-plane serves the real `POST /v1/async-operation-query` route
from `services/provisioning-orchestrator/src/actions/async-operation-query.mjs`, but the
boot schema applier did not apply the async operations migrations.

The list query path executes `SELECT COUNT(*)::int AS total FROM async_operations ...`.
When the `async_operations` table is absent, PostgreSQL raises `42P01` and the route
returns a missing-relation `500` instead of the expected `200` result set.

## What Changes

- `deploy/kind/control-plane/governance-schema.mjs`
  - Applies the provisioning-orchestrator async operations migration chain before the
    existing governance route migrations: `073`, `074`, `075`, `076`, and `078`.
  - Keeps migration order numeric and dependency-safe: base async operation tables first,
    then logs, retry/idempotency, timeout/cancel/recovery, and intervention schema.
- `deploy/kind/control-plane/server.mjs`
  - Updates the boot comment to describe the broader provisioning-orchestrator schema
    coverage required by served real actions.
- `tests/blackbox/governance-schema-bootstrap.test.mjs`
  - Adds regression coverage using the real migration SQL and boot applier.
  - Asserts boot creates `async_operations`, `async_operation_transitions`, and
    `async_operation_log_entries`.
  - Exercises the actual `async-operation-query` action list/log paths against a
    schema-aware fake DB so missing tables would fail with a simulated `42P01`.
- `tests/unit/async-operations-schema-bootstrap.test.mjs`
  - Adds the same acceptance guard to CI's `pnpm test:unit` slice: boot applies the
    async migration chain, the queried tables exist, and the list query returns `200`.
- `deploy/kind/control-plane/required-migrations.txt` and `deploy/kind/README.md`
  - Document that the async operations migration chain is part of the kind
    control-plane boot-required schema.
- `openspec/changes/fix-736-async-operations-schema/specs/web-console/spec.md`
  - Adds the acceptance requirement and the exact WHEN/THEN scenario from issue #736.

## Scope

This is a backend/deploy schema bootstrap fix. It does not change the
`/v1/async-operation-query` request or response shape, route path, status-code contract,
OpenAPI/SDK artifacts, generated clients, or the web console implementation.

The frontend already calls `POST /v1/async-operation-query` and can consume an empty
`200` list result. No frontend change is needed because the bug is the backend boot
database schema being incomplete wherever the existing route is served.

## Capabilities

### Added Capabilities

- `web-console`: operations query availability depends on the control-plane applying the
  provisioning-orchestrator async operations schema before serving the real operations
  query route.
