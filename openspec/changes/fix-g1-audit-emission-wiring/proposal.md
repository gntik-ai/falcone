## Why

The storage adapter constructs well-formed audit events for every operation but
never publishes them in production. From
`openspec/audit/cap-g1-object-storage-adapter.md`:

- **B7** (`services/adapters/src/storage-audit-ops.mjs:633`) —
  `emitStorageAuditEvent(auditEvent, context)` is exported but `grep -rn`
  shows the call sites are only `tests/adapters/storage-audit-ops.test.mjs:175,
  180` and the import in `tests/unit/storage-admin.test.mjs:41`. No production
  code path actually invokes the emitter; every `build*AuditEvent` helper
  returns events that are dropped on the floor.
- **G3** (audit-events as "executor" mixed with compilers) — pure-builder
  modules build events without a wiring contract for who publishes them.
- **G28** (no production audit traffic across storage data plane).
- **G29** (no production audit traffic across storage admin plane).
- **G30** (façade re-exports the emitter at
  `apps/control-plane/src/storage-admin.mjs:106, 162` but never invokes it).
- **G31** (`previewStorageExportResult` / `previewStorageImportResult` build
  audit events but return them without publishing,
  `apps/control-plane/src/storage-admin.mjs:500-540`).

## What Changes

- Inject `emitStorageAuditEvent` at every façade entry point where a
  `build*AuditEvent` helper is called today, so each operation produces a
  published event before returning to the caller.
- Replace the silent test-only call sites with a façade-level
  `withStorageAuditEmission(context, async () => …)` wrapper that captures
  every `buildStorageAuditEvent` result and publishes it via the context's
  publisher; absence of the publisher MUST fail closed (throw, not silently
  drop).
- Wire `previewStorageExportResult` and `previewStorageImportResult` in
  `apps/control-plane/src/storage-admin.mjs:500-540` to publish the audit
  events they build.
- Add observability counters (`storage_audit_events_published_total` and
  `storage_audit_events_dropped_total`) so a future regression is visible.

## Capabilities

### Modified Capabilities

- `data-services`: requirement that every storage operation that builds an
  audit event also publishes it, and that absence of a publisher fails closed.

## Impact

- **Affected code**: `services/adapters/src/storage-audit-ops.mjs:633`
  (emitter), `apps/control-plane/src/storage-admin.mjs:106, 162, 500-540`
  (façade re-export + preview helpers), every façade entry point that calls
  `build*AuditEvent` (per-helper sites enumerated in the audit), plus
  metrics wiring in the platform metrics registry.
- **Migration required**: none in storage; the audit Kafka topic
  `storage.audit.events` already exists per the contract.
- **Breaking changes**: deployments that ran without a wired audit publisher
  will now fail at start-up rather than silently dropping audit traffic. This
  matches the compliance contract the platform publishes.
- **Out of scope**: event-notification delivery wiring (G-S9.1; tracked under
  the event-notifications module separately); audit Kafka topic provisioning
  (operated by `secret-audit-pipeline`).
