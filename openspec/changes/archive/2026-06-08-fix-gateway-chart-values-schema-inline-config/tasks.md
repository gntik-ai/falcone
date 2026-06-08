## 1. Add Failing Black-Box Test

- [x] 1.1 Add test `bbx-chart-inline-object-schema` to `tests/blackbox/` that runs `helm template falcone charts/in-falcone` (via `child_process.execSync` or equivalent) and asserts the command exits with code 0; assert the rendered output contains at least one ConfigMap or Deployment (confirming a real render, not an empty result)
- [x] 1.2 Confirm the test fails (red) against the current unpatched `values.schema.json` before proceeding — expected failure: non-zero exit code with schema validation errors for `/observability/config/inline/metricsStack` and `/webConsole/config/inline/auth`

## 2. Implement the Fix

- [x] 2.1 Open `charts/in-falcone/values.schema.json` and locate the `config.inline.additionalProperties.type` array (near line 1950); confirm whether the `inline` definition is inline or referenced via `$ref` / `$defs`
- [x] 2.2 Extend the `type` array from `["string","number","boolean"]` to `["string","number","boolean","object","array"]` at every occurrence of the scalar-only constraint under `config.inline.additionalProperties` (typically one location if defined via `$defs`, otherwise each component section)
- [x] 2.3 Run `helm template falcone charts/in-falcone` and confirm it exits 0 with no schema-validation errors
- [x] 2.4 Run `helm lint charts/in-falcone` and confirm it exits 0

## 3. Verify

- [x] 3.1 Confirm `bbx-chart-inline-object-schema` now passes (green)
- [x] 3.2 Run `npm run validate:deployment-chart` and confirm it exits 0
- [x] 3.3 Run `node --test tests/contracts/deployment-chart.contract.test.mjs` and confirm all tests pass
- [x] 3.4 Run `bash tests/blackbox/run.sh` and confirm no regressions
