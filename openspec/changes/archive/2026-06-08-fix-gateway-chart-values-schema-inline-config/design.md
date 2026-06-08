## Context

`charts/in-falcone/values.schema.json` defines a shared `config` block (reused across all Helm component wrappers) that constrains `config.inline` as:

```json
"inline": {
  "type": "object",
  "additionalProperties": {
    "type": ["string", "number", "boolean"]
  }
}
```

This scalar-only constraint was appropriate when `inline` was first introduced for simple key-value config overrides. Two components have since added structured objects under `inline`:

- `observability.config.inline.metricsStack` (`values.yaml` lines 1992–2017): a deeply nested configuration tree for the metrics collection stack.
- `webConsole.config.inline.auth` (`values.yaml` lines 2237–2242): an object grouping auth-related path and realm config.

Both violate the current schema, causing `helm template` to fail entirely and blocking `tests/e2e/stack.sh up`.

## Goals / Non-Goals

**Goals:**
- Allow `config.inline` values to be objects or arrays, not just scalars.
- Keep all existing scalar inline values valid (additive relaxation only).
- Restrict the change to `config.inline.additionalProperties`; do not loosen any other schema constraint.
- Ensure `helm template`, `helm lint`, `npm run validate:deployment-chart`, and the deployment-chart contract tests all pass after the fix.

**Non-Goals:**
- Changing any runtime behavior of components that consume inline config.
- Adding validation of the *shape* of nested inline objects (that is component-specific and out of scope for the shared schema).
- Modifying `values.yaml` or any component chart.

## Decisions

**Decision: Extend the `additionalProperties.type` array to `["string","number","boolean","object","array"]`.**

Rationale: The minimal, backwards-compatible change. All existing scalar keys remain valid. Nested objects (`metricsStack`, `auth`) and arrays (e.g. `requiredLabels`, `downsampledResolutions` inside `metricsStack`) both become valid. The `type` array union is the standard JSON Schema mechanism for permitting multiple value types without making the entire schema open (`additionalProperties: true`), which would be too permissive.

**Alternative considered: Replace `additionalProperties` with `additionalProperties: true`.**
Rejected: Too broad — would silently allow any structure including invalid ones. The type-array approach preserves intent while fixing the immediate breakage.

**Alternative considered: Extract per-component `inline` schemas with explicit property definitions.**
Rejected: Out of scope for a bug fix; each component would need its own schema definition, requiring significant schema surgery and ongoing maintenance. The shared `inline` block was designed to be flexible by intent.

## Risks / Trade-offs

**Risk:** Extending `additionalProperties.type` allows any arbitrarily nested object under `inline`, which could obscure misconfigured values at deploy time.
**Mitigation:** The `inline` map is explicitly an escape hatch for component-specific configuration that does not fit the structured schema; runtime validation of inline values is the responsibility of each component, not the Helm schema. The bug fix restores the deploy path without changing runtime semantics.

**Risk:** If the shared `config` block is defined via `$defs` / `$ref` in `values.schema.json`, there may be multiple usages that need updating in one place.
**Mitigation:** The task steps include reading the schema to confirm whether the inline definition is a local block or a `$ref`, and patching accordingly.
