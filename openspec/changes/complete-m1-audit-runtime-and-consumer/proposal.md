## Why

`services/audit/` is contract scaffolding with no runtime — every audit
emitter elsewhere in the repo builds its own event shape ad-hoc, never
referencing the canonical envelope. From
`openspec/audit/cap-m1-audit-contract-surface.md`:

- **B1** (`services/audit/`, four files, ~52 LOC) — the package exposes
  only re-exports + one inlined event constant. No `emit`, `persist`,
  `query`, or `export` function. The README admits this directly:
  "Future tasks should extend this package for query/export behavior".
- **B2** (`grep -rln services/audit/src/contract-boundary` returns only
  `tests/contracts/internal-service-map.contract.test.mjs` and
  `scripts/validate-structure.mjs`) — no production code consumes the
  contract handles. Every audit emitter (D1, F3, H1, I1, K1, L1) builds
  its own event ad-hoc.
- **G1** (`services/audit/src/README.md`) — the package admits it is a
  scaffolding-only layer.
- **G2** (same `grep`) — zero production consumers.
- **G3** (`services/audit/package.json:7-9`) — lint/test/typecheck are
  `node -e "console.log('… placeholder')"` stubs.
- **G6** (cross-service grep across D1, F3, H1, I1, K1, L1) — no code
  anywhere emits events conforming to the 10-field canonical envelope
  (`event_id, event_timestamp, actor, scope, resource, action, result,
  correlation_id, origin, detail`).

## What Changes

- Build `services/audit/src/emit.mjs` exporting a single
  `emitAuditEvent(envelope)` function that validates against the canonical
  schema (AJV-backed), routes to `audit.<tenant_id>` or `audit.platform`,
  enforces the masking-policy forbidden-field list, and surfaces freshness
  metrics.
- Wire `services/audit/` into the monorepo as the single audit producer
  port; migrate one consumer (the backup-status emitter from L1) as the
  reference integration so the contract has a real customer.
- Replace the placeholder package scripts with real `vitest` and `eslint`
  runs covering the new runtime.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: audit-event emission runtime, consumer
  reference wiring, and package-script contract.

## Impact

- **Affected code**: new `services/audit/src/emit.mjs`,
  `services/audit/src/topic-router.mjs`,
  `services/audit/src/masking-policy.mjs`,
  `services/audit/src/metrics.mjs`,
  `services/audit/src/schema-validator.mjs`; rewritten
  `services/audit/package.json`; migrated
  `services/backup-status/src/audit/audit-emitter.mjs` to call
  `emitAuditEvent`.
- **Migration required**: none at the storage layer; Kafka topic
  `audit.<tenant_id>` / `audit.platform` must be pre-created (or
  auto-created in dev).
- **Breaking changes**: the L1 backup-status emitter switches from
  `platform.audit.events` to `audit.<tenant_id>`; downstream consumers
  must be re-subscribed. Other emitters (D1, F3, H1, I1, K1) are out of
  scope for this change and migrate in follow-ups.
- **Out of scope**: query, export, and correlation surface
  implementation (separate proposals); migration of the other five
  ad-hoc emitters.
