## Why

Three observability contracts disagree on the quota-dimension vocabulary,
and a fourth contract carries duplicate keys for the same posture. From
`openspec/audit/cap-m4-observability-metrics.md`:

- **B1** (`services/internal-contracts/src/observability-hard-limit-enforcement.json:62-150`
  vs `observability-quota-policies.json:128-138` vs
  `observability-usage-consumption.json:10-14`) — `hard-limit-enforcement`
  declares 8 dimension ids
  `{api_requests, serverless_functions, storage_buckets, logical_databases,
  kafka_topics, collections_tables, realtime_connections, error_budget}`;
  `quota-policies` declares 9 different ids
  `{api_requests, function_invocations, storage_volume_bytes,
  data_service_operations, realtime_connections, logical_databases,
  topics, collections_tables, error_count}`; `usage-consumption` aligns
  with quota-policies. **`serverless_functions / storage_buckets /
  kafka_topics / error_budget` have no canonical mapping in the other two
  contracts.**
- **B2** (`services/internal-contracts/src/observability-quota-usage-view.json:78-115`)
  — the posture-mapping table has duplicate keys: both `within_limit` AND
  `within_limits` map to `healthy`; both `warning_threshold_reached` AND
  `warning_reached` map to `warning`. Consumers using one variant produce
  lookup failures against producers using the other.
- **G-S12.2** — no cross-contract validator detects the divergence; each
  validator checks only its own contract.

## What Changes

- Pick `quota-policies.json` as the **canonical vocabulary** (it is the
  most-referenced and matches the metering rollups in
  `usage-consumption.json`). Migrate `hard-limit-enforcement.json` to use
  the same 9 dimension ids; document the rename in the contract changelog.
- Collapse the `quota-usage-view.json` posture-mapping duplicate keys to a
  single canonical name per posture (`within_limit`,
  `warning_threshold_reached`, `soft_limit_exceeded`,
  `hard_limit_reached`); the other variants are removed.
- Add `scripts/lib/observability-cross-contract.mjs` and
  `scripts/validate-observability-cross-contract.mjs` that read all 10
  observability JSON contracts, extract their dimension and posture
  vocabularies, and assert they are subsets of the canonical sets. CI
  fails on any divergence.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on a single canonical
  quota-dimension vocabulary across the three contracts, on a single
  canonical posture name per state in `quota-usage-view`, and on a CI
  cross-contract validator that prevents the next drift.

## Impact

- **Affected code**: `services/internal-contracts/src/observability-hard-limit-enforcement.json`
  (dimension renames),
  `services/internal-contracts/src/observability-quota-usage-view.json`
  (duplicate-key removal); new
  `scripts/lib/observability-cross-contract.mjs` +
  `scripts/validate-observability-cross-contract.mjs`; edit of
  `package.json:scripts.validate:repo` to include the new validator.
- **Migration required**: any consumer code (currently none in source,
  per `complete-m4-metrics-handlers`'s findings) that switched on the old
  `hard-limit-enforcement` ids `serverless_functions / storage_buckets /
  kafka_topics / error_budget` must rename to `function_invocations /
  storage_volume_bytes / topics / error_count`.
- **Breaking changes**: alert payloads currently keyed on the old
  duplicate posture names will receive the canonical name; document the
  rename in the change PR and provide a one-shot translation table for
  external dashboard authors.
- **Cross-cutting**: precondition for `fix-m4-invariant-enforcement` which
  enforces threshold ordering per dimension — the dimension vocabulary
  must agree first.
