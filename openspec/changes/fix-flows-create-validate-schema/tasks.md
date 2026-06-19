# Tasks — fix-flows-create-validate-schema

## Reproduce (test-first)
- [x] Added a failing black-box test
  (`tests/blackbox/flows-create-validate-schema.test.mjs`, bbx-625-01..07) that drives the flows HTTP
  surface and asserts: create with a `params`/`parameters` task node or a `{startAt,states}` shape →
  400 `FLOW_DEFINITION_INVALID`; create with `input` → 201 then validate 200 + publish 201; a
  semantic-only violation still creates (201) and fails 422 at validate/publish; a PATCH supplying a
  `params` definition → 400; validate of a structurally-bad stored draft → 400 — failing while the
  runtime ran only the semantic validator.

## Implement
- [x] New `services/internal-contracts/src/flow-definition-schema-validator.mjs`
  (`validateFlowDefinitionSchema`, `FLOW_SCHEMA_ERROR_CODE`); exported from `index.mjs`.
- [x] `apps/control-plane/src/runtime/flow-executor.mjs`: `runValidation` runs JSON Schema → semantic;
  `validationError` maps schema→400 / semantic→422; `createDefinition` + `update_definition` enforce
  the schema at the write boundary.
- [x] `services/internal-contracts/src/flow-definition.json`: added `trigger.options`
  (`overlap` enum + `catchupWindow`) to match the trigger registry.
- [x] `apps/control-plane/package.json` + `services/internal-contracts/package.json`: added `ajv`.
- [x] `tests/live-campaign/verify-p1-flows.mjs`: `params` → `input` in the first-party example.

## Verify
- [x] New black-box test passes (7/7); existing flows black-box suite green (191/191) including the
  cron-trigger tests; flow contract + unit + dsl-schema tests green (56/56).
- [x] Error messages name the offending field (e.g. "must NOT have additional properties ('params')");
  a bad `overlap` enum value is rejected.
- [ ] Acceptance: on the kind stack, creating a flow with a `params` task node returns 400 (was 201
  then a runtime "Table undefined.undefined not found"); the same flow with `input` executes
  (real-stack verification).

## Archive
- [ ] `openspec validate fix-flows-create-validate-schema --strict`; archive after merge.
