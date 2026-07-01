## 1. Reproduce / Encode The Issue

- [x] 1.1 Parse issue #768 acceptance criteria:
  - Requirement: metrics time-range controls must either affect rendered metrics or be clearly
    non-applicable where windowing does not apply.
  - Scenario: tenant-scoped Metrics must not silently refetch identical data when the time range is
    changed.
- [x] 1.2 Identify the root cause: tenant scope loads `/overview` and `/usage` only, while
  `window=` is attached only to the workspace-scoped `/series` request.
- [x] 1.3 Add regression coverage for tenant non-applicability, workspace active range changes, and
  hook request behavior.

## 2. Web Console

- [x] 2.1 Disable and label the Observability Metrics time-range selector when no active workspace
  is selected.
- [x] 2.2 Keep the selector active at workspace scope.
- [x] 2.3 Avoid using range changes as a reload key for tenant-only metrics.
- [x] 2.4 Preserve workspace `/series?metricKey=api_requests&window=24h|7d|30d` requests.
- [x] 2.5 Remove unsupported custom from/to range controls from the active workspace selector
  until a real custom range API exists.

## 3. Specs And Docs

- [x] 3.1 Materialize this OpenSpec change under
  `openspec/changes/fix-768-observability-time-range/`.
- [x] 3.2 Add a web-console MODIFIED requirement for metrics time-range effect/non-applicability.
- [x] 3.3 Add a concise architecture/reference note for observability metrics time-range scope.
- [x] 3.4 Document that active console metric windows are the supported presets only (`24h`,
  `7d`, and `30d`).
- [x] 3.5 Leave backend, OpenAPI/AsyncAPI, generated SDKs, shared wire types, and route catalog
  unchanged because no wire contract changes are required.

## 4. Verification

- [x] 4.1 Run focused web-console tests for `ConsoleObservabilityPage`,
  `ConsoleTimeRangeSelector`, and `console-metrics`.
- [x] 4.2 Run `openspec validate fix-768-observability-time-range --strict`.
- [x] 4.3 Run public API generation/validation if applicable and confirm no generated diff.
- [x] 4.4 Run `git diff --check`.
