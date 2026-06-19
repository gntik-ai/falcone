# workflows — spec delta for fix-flows-create-validate-schema

## ADDED Requirements

### Requirement: Flow create/validate/publish MUST enforce the DSL JSON Schema

The system SHALL validate a flow definition against the published DSL JSON Schema
(`flow-definition.json`) — structural rules: required fields, node-type enum, `additionalProperties:false`,
the task-node param field named `input` — BEFORE the semantic validator (FLW-E001..009), on create, on
update (PATCH) when a definition is supplied, on `/validate`, and on publish. A structural violation
(e.g. a task node using `params`/`parameters` instead of `input`, or an unsupported top-level shape)
SHALL be rejected with `400 FLOW_DEFINITION_INVALID` and a schema-violation message naming the
offending field — so authors get an actionable error before publish rather than a misleading activity
failure at runtime. Semantic violations SHALL continue to be rejected with `422 FLOW_VALIDATION_FAILED`.
An empty draft (no definition supplied) MAY be created and is validated once a definition exists. The
first-party examples SHALL use the schema field `input`.

#### Scenario: task node with `params` instead of `input` is rejected at create

- **WHEN** a flow is created with a task node carrying `params: {...}` (no `input`)
- **THEN** create returns `400 FLOW_DEFINITION_INVALID` (schema violation: additional property
  `params`), not `201`

#### Scenario: unknown node field rejected at validate

- **WHEN** a stored draft contains a task node with `params`/`parameters` (not in the schema) and
  `/validate` is called
- **THEN** validate returns `400 FLOW_DEFINITION_INVALID`, not `200 {valid:true}`

#### Scenario: unsupported top-level shape rejected

- **WHEN** a flow is created with a Step-Functions-style `{startAt, states}` document (no
  `apiVersion`/`name`/`nodes`)
- **THEN** create returns `400 FLOW_DEFINITION_INVALID` (missing required fields / unknown top-level
  properties), not `201`

#### Scenario: schema-correct definition is accepted

- **WHEN** a flow is created with a task node using the schema field `input`
- **THEN** create returns `201`, `/validate` returns `200 {valid:true}`, and publish returns `201`

#### Scenario: semantic violations keep the 422 contract

- **WHEN** a structurally-valid definition has a semantic violation (duplicate node ids, dangling
  edge, cyclic graph)
- **THEN** it is accepted at create (`201`) and rejected at `/validate` and publish with
  `422 FLOW_VALIDATION_FAILED` (FLW-E001..009), not `400`

### Requirement: The DSL schema MUST model cron trigger options

The DSL JSON Schema's `trigger` definition SHALL include an `options` object with `overlap` (a closed
enum of the friendly overlap-policy names the trigger registry maps to the Temporal ScheduleOverlapPolicy)
and `catchupWindow` (a duration string), matching the fields the trigger registry consumes — so a
legitimate cron trigger with options validates rather than being rejected by `additionalProperties:false`.

#### Scenario: cron trigger with options validates

- **WHEN** a flow declares a cron trigger with `options: { overlap: 'skip', catchupWindow: '5m' }`
- **THEN** the definition passes structural validation (the `options` object is part of the schema)

#### Scenario: an unknown overlap value is rejected

- **WHEN** a cron trigger declares `options: { overlap: <not-in-the-enum> }`
- **THEN** the definition fails structural validation (`400`)
