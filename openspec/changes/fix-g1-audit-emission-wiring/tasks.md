## 1. Failing tests

- [ ] 1.1 [test] Add `tests/unit/storage-admin-audit-emission.test.mjs` that
      drives each façade entry point in
      `apps/control-plane/src/storage-admin.mjs` (bucket CRUD, object CRUD,
      policy decision, presigned URL, multipart completion, usage query,
      export/import preview) and asserts the supplied
      `context.publishAuditEvent` was invoked once per call (proves B7 at
      `services/adapters/src/storage-audit-ops.mjs:633` and G30/G31 at
      `apps/control-plane/src/storage-admin.mjs:106, 162, 500-540`).
- [ ] 1.2 [test] Add a case asserting that calling any façade entry point
      with `context.publishAuditEvent` unset throws
      `STORAGE_AUDIT_PUBLISHER_MISSING`, not a silent drop.

## 2. Implementation

- [ ] 2.1 [impl] Introduce `withStorageAuditEmission(context, fn)` in
      `apps/control-plane/src/storage-admin.mjs` that captures every audit
      event built inside `fn` and publishes them via
      `context.publishAuditEvent` before returning.
- [ ] 2.2 [fix] Wrap every façade entry point that calls a `build*AuditEvent`
      helper with `withStorageAuditEmission`; remove the dead re-export
      pattern at `:106, 162` in favour of a single publication path.
- [ ] 2.3 [fix] Wire `previewStorageExportResult` and
      `previewStorageImportResult` at `:500-540` to publish their audit
      events; drop the "build-and-return" pattern.
- [ ] 2.4 [fix] Change `emitStorageAuditEvent` at
      `services/adapters/src/storage-audit-ops.mjs:633` so the absent-publisher
      branch throws `STORAGE_AUDIT_PUBLISHER_MISSING` instead of silently
      returning.
- [ ] 2.5 [impl] Register
      `storage_audit_events_published_total` and
      `storage_audit_events_dropped_total` counters in the platform metrics
      registry and increment them from `withStorageAuditEmission`.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/data-services/spec.md`
      asserting every storage operation publishes its audit event and that
      a missing publisher fails closed.
- [ ] 3.2 [docs] Document the new wiring contract in the adapter README and
      the storage-admin façade README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'storage-admin|storage-audit-ops'`
      and `openspec validate fix-g1-audit-emission-wiring --strict`; both
      green before merge.
