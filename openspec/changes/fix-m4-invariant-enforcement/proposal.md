## Why

Four invariants declared in M4 contracts are unenforced at runtime: the
forbidden-labels list, the forbidden alert-payload fields list, the
threshold ordering rule, and the usage-window time invariant. From
`openspec/audit/cap-m4-observability-metrics.md`:

- **B11** (`services/internal-contracts/src/observability-metrics-stack.json:86-95`)
  — the contract bans labels `user_id, session_id, request_id, raw_path,
  object_key, …` from metric emissions, but no runtime emitter is
  checked. A producer adding `user_id` as a label silently inflates
  cardinality past the budget.
- **B12** (`services/internal-contracts/src/observability-console-alerts.json:411-422`)
  — the contract bans alert-payload fields `password, secret, token,
  connection_string, raw_hostname, raw_endpoint, object_key,
  raw_topic_name`. No console-alert emitter scrubs them; sensitive
  material can leak into operator-facing alerts.
- **B13** (`services/internal-contracts/src/observability-quota-policies.json:113-127`)
  — `warning ≤ soft_limit ≤ hard_limit` is declared as a constraint but
  not enforced when a policy is written. A policy `{warning: 90, soft:
  80, hard: 70}` validates by schema and produces nonsensical posture
  transitions.
- **B15** (`services/internal-contracts/src/observability-usage-consumption.json:218-226`)
  — `startedAt ≤ endedAt` is declared but unenforced. Snapshot creators
  can produce reversed-time windows.
- **G-S2.1/G-S3.1/G-S7.1/G-S8.1/G-S10.1** — the cross-cutting "declarative
  only, unenforced at runtime" pattern.

## What Changes

- Add an `enforceLabelAllowlist(labels)` guard inside the recorder
  introduced by `complete-m4-metrics-handlers`. Every `counter.inc`,
  `gauge.set`, `histogram.observe` call passes labels through the guard;
  the guard throws synchronously on any label key in the forbidden list.
- Add a `scrubAlertPayload(payload)` guard inside the emitter; every
  console-alert emit passes the payload through the scrubber, which
  rejects the call with a synchronous error if any forbidden field is
  present (vs. silently dropping the field, so producers can't hide a
  bug).
- Add a write-time policy validator
  `validateThresholdOrdering(warning, soft, hard)` invoked at every
  policy-write site in the quota engine; the validator throws when
  ordering is violated.
- Add a snapshot-create guard
  `assertObservationWindow(startedAt, endedAt)` invoked at every
  snapshot-write site in `services/metrics-runtime/` and in the
  provisioning orchestrator; throws when the invariant is violated.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on runtime enforcement of the
  four declarative invariants (label allowlist, alert-payload scrub,
  threshold ordering, observation-window ordering) at recorder, emitter,
  policy-write, and snapshot-write time respectively.

## Impact

- **Affected code**: `services/metrics-runtime/src/recorder.mjs` (label
  guard), `services/metrics-runtime/src/emitter.mjs` (payload guard),
  `services/provisioning-orchestrator/src/quota/policy-writer.mjs`
  (ordering validator),
  `services/metrics-runtime/src/snapshot-writer.mjs` (window guard);
  edits at every call site that currently produces a snapshot or writes
  a policy.
- **Migration required**: any existing policy row that violates
  ordering must be migrated to a valid set before this lands; provide a
  one-shot SQL audit (`SELECT … WHERE warning > soft OR soft > hard`)
  in the migration notes.
- **Breaking changes**: producers using forbidden labels or fields will
  throw at runtime rather than silently mis-emit; this is the intended
  behaviour and the throw stack identifies the bug.
- **Cross-cutting**: depends on `complete-m4-metrics-handlers` for the
  recorder/emitter where the guards live; depends on
  `fix-m4-quota-vocabulary-alignment` for the canonical dimension
  vocabulary the threshold validator keys on.
