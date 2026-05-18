## 1. Failing tests

- [ ] 1.1 [test] Add `tests/contracts/observability-cross-contract.test.mjs`
      that loads all three quota-related contracts and asserts the
      dimension-id set in `hard-limit-enforcement.json` equals the set in
      `quota-policies.json` and `usage-consumption.json` (proves B1's
      invariant).
- [ ] 1.2 [test] Add a case that loads `observability-quota-usage-view.json`
      and asserts no two keys in the posture-mapping table map to the same
      visual state with different naming (proves B2's invariant).
- [ ] 1.3 [test] Add a case that runs
      `scripts/validate-observability-cross-contract.mjs` against a
      synthetic fixture where one contract drifts and asserts the
      validator exits non-zero.

## 2. Implementation

- [ ] 2.1 [fix] Edit
      `services/internal-contracts/src/observability-hard-limit-enforcement.json:62-150`
      to rename `serverless_functions → function_invocations`,
      `storage_buckets → storage_volume_bytes`,
      `kafka_topics → topics`, `error_budget → error_count`; add a
      `previousIds` array on each renamed dimension for traceability.
- [ ] 2.2 [fix] Edit
      `services/internal-contracts/src/observability-quota-usage-view.json:78-115`
      to keep only the canonical posture keys (`within_limit`,
      `warning_threshold_reached`, `soft_limit_exceeded`,
      `hard_limit_reached`) and remove the duplicate variants
      (`within_limits`, `warning_reached`).
- [ ] 2.3 [impl] Create
      `scripts/lib/observability-cross-contract.mjs` exporting
      `collectObservabilityCrossContractViolations()` that loads all 10
      observability contracts, extracts dimension and posture vocabularies,
      and returns a violations array.
- [ ] 2.4 [impl] Create
      `scripts/validate-observability-cross-contract.mjs` following the
      shape of the existing 15 validators; wire it into
      `package.json:scripts.validate:repo`.

## 3. Validation

- [ ] 3.1 [docs] Add a "Canonical vocabulary" section to
      `services/internal-contracts/src/README.md` (or create one) that
      lists the 9 dimension ids and the 4 canonical posture names.
- [ ] 3.2 [test] Run `corepack pnpm lint`, the contract suite, and
      `openspec validate fix-m4-quota-vocabulary-alignment --strict`;
      all green before merge.
