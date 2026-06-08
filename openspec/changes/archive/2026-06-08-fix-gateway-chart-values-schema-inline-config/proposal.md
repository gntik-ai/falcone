## Why

`charts/in-falcone/values.schema.json` defines a shared `config.inline` block whose `additionalProperties` type is constrained to the scalar union `["string","number","boolean"]` (lines 1944–1956). Two components in `charts/in-falcone/values.yaml` set nested **object** values under `config.inline`:

- `observability.config.inline.metricsStack` — a deeply nested object carrying retention, label, and tenant-isolation config (lines 1992–2017)
- `webConsole.config.inline.auth` — an object with realm, clientId, and path keys (lines 2237–2242)

Because these values violate the scalar-only constraint, `helm template falcone charts/in-falcone` fails JSON-Schema validation:

```
at '/observability/config/inline/metricsStack': got object, want boolean or number or string
at '/webConsole/config/inline/auth': got object, want boolean or number or string
```

`tests/e2e/stack.sh up` calls `helm upgrade --install … --wait`; the render failure prevents it from ever bringing the stack up. No `/e2e-issue` run can deploy. The breakage is present on a clean `main` tree and is unrelated to any single feature branch.

## What Changes

- Relax the `additionalProperties` constraint on the `config.inline` property in `charts/in-falcone/values.schema.json` to accept `"object"` and `"array"` values in addition to scalars, so that nested inline config objects (e.g. `metricsStack`, `auth`) pass validation. Scalar values must remain valid (no regression for existing scalar inline keys).
- Scope the relaxation strictly to the `inline` map; the surrounding `config` object and the rest of the chart schema must not become more permissive.
- Acceptance criteria: `helm template falcone charts/in-falcone` exits 0; `helm lint charts/in-falcone` exits 0; `npm run validate:deployment-chart` exits 0; `node --test tests/contracts/deployment-chart.contract.test.mjs` passes.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: The Helm chart SHALL render without schema-validation errors when inline component config contains nested object or array values, not just scalars.

## Impact

- `charts/in-falcone/values.schema.json` — `config.inline.additionalProperties.type` relaxed from `["string","number","boolean"]` to include `"object"` and `"array"`
- `charts/in-falcone/values.yaml` — no change required; `observability.config.inline.metricsStack` and `webConsole.config.inline.auth` already contain the correct data
- `tests/contracts/deployment-chart.contract.test.mjs` — existing tests verify chart structure; no new test files are required, but a `helm template` smoke step must pass as part of verification
- `scripts/validate-deployment-chart.mjs` (via `npm run validate:deployment-chart`) — must continue to pass
