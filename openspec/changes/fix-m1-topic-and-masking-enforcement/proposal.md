## Why

The canonical pipeline declares two strict rules — `audit.<tenant_id>`
topic naming and a forbidden-field masking list — that no producer in the
repo honours. From `openspec/audit/cap-m1-audit-contract-surface.md`:

- **B7** (cross-referenced from D1, F3, H1, I1, K1, L1 audits) — five
  different topic conventions are in use:
  `'console.audit.gateway'` (D1), `'console.webhook.subscription.*'`
  (F3), `'console.audit'` (K1), `'platform.audit.events'` and
  `'platform.backup.collector.events'` (L1), `'mongo.admin'` (H1). The
  canonical contract (`observability-audit-pipeline.json:154-158`)
  declares `audit.<tenant_id>` for tenant scope and `audit.platform`
  for platform scope; none of the five matches.
- **B8** (`observability-audit-pipeline.json:272-282`) — the masking-policy
  forbidden-field list (`password, secret, token, authorization_header,
  connection_string, raw_hostname, raw_endpoint, object_key,
  raw_topic_name`) has no enforcing validator anywhere in the repo. The
  L1 audit found a separate regex sanitiser in `storage-error-taxonomy.mjs`
  that uses a different list.
- **G7** — five+ topic naming conventions vs one declared in the
  contract.
- **G8** — masking policy is advisory only; no code enforces it.

## What Changes

- Add a `validateTopicName(topic, envelope)` function that throws if a
  producer publishes to anything other than `audit.${tenant_id}` or
  `audit.platform`; integrate into the M1 emit runtime (depends on
  `complete-m1-audit-runtime-and-consumer`).
- Add an `applyMaskingPolicy(envelope)` that strips every key on the
  forbidden-field list (case-insensitive, exact and `_<field>` /
  `<field>_` suffix/prefix variants) before publish.
- Add a repo-wide lint rule (`eslint-plugin-no-restricted-syntax`) that
  fails CI when any source file under `services/` or
  `apps/control-plane/src/` references a Kafka topic literal matching
  the legacy conventions; producers must call the canonical router
  instead.
- Document the canonical topic conventions in
  `services/audit/src/README.md`.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: topic-name router contract, masking-policy
  enforcement, and CI lint to prevent regression.

## Impact

- **Affected code**: `services/audit/src/topic-router.mjs`,
  `services/audit/src/masking-policy.mjs`,
  `services/audit/test/topic-router.test.mjs`,
  `services/audit/test/masking-policy.test.mjs`, lint config under the
  repo root.
- **Migration required**: per-emitter migration is out of scope; this
  change ships the enforcement primitives plus the lint rule that will
  fail CI on legacy emitters.
- **Breaking changes**: CI will fail for any source that publishes to
  the legacy topic literals; per-emitter `fix-*` proposals migrate them
  one by one.
- **Out of scope**: rewriting the per-capability emitters (D1, F3, H1,
  I1, K1) — sequenced under separate proposals.
