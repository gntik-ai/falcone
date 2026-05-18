## Why

The function-admin trigger surface accepts arbitrary inputs for Kafka and
storage triggers, misclassifies export/import resources as web-action carriers,
and has no concurrency limit in the quota guardrails. From
`openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B9** (`apps/control-plane/src/functions-import-export.mjs:174-176`) —
  `resourceTypeHasWebActions` returns true for both `function_action` /
  `action` AND for `function_definition_export` /
  `function_definition_import`. Export/import resources do not themselves
  have web actions; the visibility check fires for resources that have no
  visibility field, masking real validation gaps.
- **B14** (`services/adapters/src/openwhisk-admin.mjs:1247` Kafka,
  `:1185-1187` storage) — Kafka triggers accept arbitrary `sourceRef`
  strings; storage triggers accept arbitrary bucket name / object key /
  credential entries without format validation.
- **B15** (`openwhisk-admin.mjs:1153-1159`) — no concurrency limit in the
  quota guardrails. An action with `maxConcurrency: 10000` is accepted.
- **G8** (`openwhisk-admin.mjs:1247` Kafka source format), **G9**
  (`:1185-1187` storage trigger fields), **G10**
  (`:1153-1159` concurrency limit).

## What Changes

- Fix `resourceTypeHasWebActions` to return true only for
  `['function_action', 'action']`; export/import resources are no longer
  web-action carriers.
- Validate Kafka trigger `sourceRef` against the
  `{tenant}.{workspace}.{topic}` format already used by the realtime/cdc
  capabilities; reject malformed refs with `INVALID_KAFKA_SOURCE_REF`.
- Validate every storage trigger entry: bucket name against
  `BUCKET_NAME_PATTERN`, object-key prefix against `assertObjectKey`-style
  rules (no `..`, no control chars), and credentials must reference an
  existing workspace secret.
- Add a `MAX_ACTION_CONCURRENCY` quota guardrail (default 100, configurable
  per plan tier) and reject actions whose `maxConcurrency` exceeds it.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirements covering web-action visibility
  classification, Kafka/storage trigger validation, and per-action
  concurrency caps.

## Impact

- **Affected code**:
  `apps/control-plane/src/functions-import-export.mjs:174-176`,
  `services/adapters/src/openwhisk-admin.mjs:1247` (Kafka),
  `:1185-1187` (storage), `:1153-1159` (quota guardrails),
  `tests/adapters/openwhisk-admin.test.mjs`,
  `tests/unit/functions-import-export.test.mjs`.
- **Migration required**: none in this adapter; plan-tier `maxConcurrency`
  configuration must be added downstream.
- **Breaking changes**: tenants whose triggers carried malformed Kafka
  sourceRefs or whose actions used `maxConcurrency > MAX_ACTION_CONCURRENCY`
  will start receiving validation errors. Document the deprecation in the
  release notes.
- **Out of scope**: trigger registration runtime (the executor that wires
  triggers to OpenWhisk); secret-scope fail-open (covered by
  `fix-h1-secret-scope-fail-open`).
