## Context

Falcone has an established pattern for shared machine-readable contracts: each contract is
a JSON file under `services/internal-contracts/src/`, exported from `index.mjs`, and
exercised by a dedicated contract test. Existing examples confirm the discipline:

- `services/internal-contracts/src/console-workflow-invocation.json` — Draft-07, `$id`,
  definitions-based, `additionalProperties: false` on write-model objects.
- `services/internal-contracts/src/index.mjs` — lazy-loaded `readXxx()` helpers plus
  named re-exports (e.g. `sagaContract`, `asyncOperationStateChangedSchema`).
- `tests/contracts/console-workflow-invocation.contract.test.mjs` — imports the raw JSON,
  imports a validator helper from the implementing service, tests valid shapes and required
  rejection cases.

No `flow-definition.json` or any flow-DSL schema exists today
(`grep -ri "flow" services/internal-contracts/src` returns only incidental references in
`observability-*` and `domain-model.json`; `index.mjs` exposes `listInteractionFlows()`
which reads from `internal-service-map.json` interaction_flows — unrelated to the user-
authored flow DSL).

This change adds the schema artifact, fixtures, and contract tests only.
No runtime service code is touched.

## Goals / Non-Goals

**Goals:**
- Publish `flow-definition.json` (Draft-07, `additionalProperties: false`) with all
  required node types, header fields, and `apiVersion` versioning.
- Define semantic validation error codes `FLW-E001` through `FLW-E009` as a normative
  table that both editor and server implementations MUST reference.
- Ship five canonical fixture files under `services/internal-contracts/src/fixtures/flows/`.
- Ship a contract test that validates fixtures and rejects invalid documents.
- Document the `apiVersion` bumping policy so downstream owners can evolve the schema
  without breaking stored definitions.

**Non-Goals:**
- Implementing the semantic validator (JavaScript code) — that belongs to
  `add-flows-dsl-interpreter-worker` or `add-flows-control-plane-api`.
- Interpreter Temporal activity mapping implementation.
- Console editor integration (autocomplete, YAML editor).
- Any REST API endpoint changes.

## Decisions

### Decision 1: Draft-07 (not 2019-09 or 2020-12)

The existing contracts (`console-workflow-invocation.json`, `async-operation-*.json`)
all use `"$schema": "http://json-schema.org/draft-07/schema#"`. Staying on Draft-07
keeps the new schema loadable by the same AJV v6 instance already used in the repo
without a library upgrade. Alternative (2020-12) would need `ajv@^8` and JSON Schema
`$defs` migration across existing contracts.

### Decision 2: Single flat JSON file, definitions block for node sub-schemas

Each node type gets its own `$def`-equivalent under `definitions` inside
`flow-definition.json` (consistent with `console-workflow-invocation.json`). A
`oneOf` discriminator on the `type` field selects the matching definition. This keeps
the schema self-contained and resolvable without a multi-file `$ref` resolver, which
the editor tooling and server validator both need to handle trivially.

### Decision 3: `apiVersion` as a closed string enum, not semver integer tuple

An enum of string values (e.g. `["v1.0"]` initially) matches the pattern used in
`workspace-openapi-version.json` and maps cleanly to the evolution policy: adding a new
version is a pure additive enum extension; removing an old version is an explicit enum
removal that downstream consumers can detect. Using an integer major+minor pair in a
structured object would be more expressive but adds schema complexity for no concrete
benefit at v1.0.

### Decision 4: Semantic error codes specified in spec, not enforced by JSON Schema

Rules like "node IDs are unique" and "graph is acyclic" cannot be expressed in JSON
Schema. They are specified here as a normative table (`FLW-E001`…`FLW-E009`) so that
the three independent consumers (editor diagnostics, control-plane API 422, interpreter
pre-flight) can implement them independently but with identical error codes and
descriptions. The spec is the single source of truth; implementations are verified by
contract tests that assert both the code and the message pattern.

### Decision 5: Fixtures stored in `services/internal-contracts/src/fixtures/flows/`

Other contract packages in the repo (e.g. `tests/contracts/fixtures/`) hold test-only
fixtures that are not exported. The flow fixtures are different: they serve as
human-readable examples of valid flow definitions and are the canonical corpus consumed
by editor tooling for autocomplete snippet generation. Co-locating them with the schema
in `internal-contracts/src/fixtures/flows/` makes them importable by downstream packages
without a cross-workspace path dependency.

## Risks / Trade-offs

- **Risk: `additionalProperties: false` breaks forward-compat for editors writing future
  fields before schema update.**
  Mitigation: The `canvasMetadata` section deliberately uses `additionalProperties: true`
  to absorb editor-specific position data. The main execution graph sections are strict.
  New optional fields require a minor `apiVersion` bump, which the evolution policy covers.

- **Risk: Closed `taskType` enum couples schema to catalog.**
  Mitigation: `taskType` is typed as `string` in the schema (not an enum); the closed
  catalog constraint is enforced by semantic rule `FLW-E006` at runtime, not by JSON
  Schema. This avoids schema churn when new task types are added.

- **Risk: Five initial fixtures may not cover all node-type combinations.**
  Mitigation: The spec requires these five specific fixtures. Upstream siblings
  (#359, #360) are expected to add their own integration fixtures; this set is the
  minimum for schema validation coverage.

## Migration Plan

1. Add `flow-definition.json` and fixtures (no runtime impact, additive only).
2. Export `flowDefinitionSchema` from `index.mjs` (additive, no breaking change to
   existing consumers).
3. Add `flow-definition.contract.test.mjs`; gate on CI (additive test, no breakage).
4. Sibling changes import `flowDefinitionSchema` from `@falcone/internal-contracts`.

Rollback: remove the three new files from `internal-contracts` and the test. No database
migrations or deployed-service changes are needed.

## Open Questions

- **Expression engine syntax**: `FLW-E005` requires expressions to be parseable.
  Issue #356 (expression engine ADR) determines the concrete parser. Until #356 closes,
  expression fields in the schema are typed as `string` and `FLW-E005` enforcement is
  deferred to the interpreter worker. The schema itself has no dependency on #356.
