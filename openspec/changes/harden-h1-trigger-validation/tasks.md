## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/unit/functions-import-export.test.mjs`
      asserting `resourceTypeHasWebActions('function_definition_export') ===
      false` and that the visibility validator does not fire on
      export/import resources (proves B9 at
      `apps/control-plane/src/functions-import-export.mjs:174-176`).
- [ ] 1.2 [test] Add cases in `tests/adapters/openwhisk-admin.test.mjs`
      asserting (a) a Kafka trigger with `sourceRef: 'not_well_formed'`
      throws `INVALID_KAFKA_SOURCE_REF` (proves B14 at
      `services/adapters/src/openwhisk-admin.mjs:1247`), (b) a storage
      trigger with `bucketName: '../escape'` throws
      `INVALID_STORAGE_TRIGGER_BUCKET` (proves B14 at `:1185-1187`).
- [ ] 1.3 [test] Add a case asserting an action with `maxConcurrency:
      10000` throws `MAX_CONCURRENCY_EXCEEDED` (proves B15 at
      `openwhisk-admin.mjs:1153-1159`).

## 2. Implementation

- [ ] 2.1 [fix] Change `resourceTypeHasWebActions` at
      `functions-import-export.mjs:174-176` to
      `return ['function_action', 'action'].includes(resourceType);`.
- [ ] 2.2 [fix] At `openwhisk-admin.mjs:1247`, validate Kafka
      `sourceRef` against the `{tenant}.{workspace}.{topic}` regex used by
      the realtime/cdc capabilities; throw `INVALID_KAFKA_SOURCE_REF`.
- [ ] 2.3 [fix] At `openwhisk-admin.mjs:1185-1187`, iterate
      `storageTriggers[]` and validate each entry's bucket name, object-key
      prefix, and credential reference; reject with stable error codes.
- [ ] 2.4 [fix] At `openwhisk-admin.mjs:1153-1159`, add a
      `MAX_ACTION_CONCURRENCY` cap to the quota guardrails (default 100,
      resolved from the plan tier); reject actions whose `maxConcurrency`
      exceeds it.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`.
- [ ] 3.2 [docs] Document the new trigger validation rules and concurrency
      cap in the `functions-admin` README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'functions-import-export|openwhisk-admin'`
      and `openspec validate harden-h1-trigger-validation --strict`; both
      green before merge.
