## Why

Kafka send failures vanish, namespaces literally named `'unknown'` are
misclassified, and `eventId` / `vaultRequestId` carry different random
UUIDs when Vault doesn't supply an id. From
`openspec/audit/cap-m2-secret-audit-pipeline.md`:

- **B8** (`services/secret-audit-handler/src/kafka-publisher.mjs:30-32`)
  — `try { producer.send(...) } catch (e) { console.error(...) }`. No
  retry, no DLQ, no metric. KafkaJS internal retries (5x) exhaust silently;
  lost events are invisible.
- **B11** (`services/secret-audit-handler/src/vault-log-reader.mjs:22`)
  — `type: namespace === 'unknown' ? 'user' : 'service'`. A real
  service-account namespace literally named `'unknown'` is misclassified
  as a user action.
- **B12** (`vault-log-reader.mjs:15, :29`) — both `eventId` and
  `vaultRequestId` independently compute `entry?.request?.id ??
  randomUUID()`. When the Vault id is missing, two distinct
  `randomUUID()` calls return different values; the conceptual link is
  broken.
- **G9** — Kafka send errors swallowed.
- **G13** — no `idempotent: true` (covered by `harden-m2-runtime-operations`
  separately); this proposal focuses on the failure-observability and
  id-binding correctness.
- **G14** — no DLQ for failed publishes.

## What Changes

- Replace the swallow at `kafka-publisher.mjs:30-32` with a re-throw
  after recording a `vault_audit_publish_failures_total` counter and
  publishing the failed event to `audit.dlq.secret-audit-publish` (a
  separate DLQ from the parse-error DLQ).
- Replace the literal-`'unknown'` heuristic at
  `vault-log-reader.mjs:22` with a presence check on the namespace
  field: `type: entry.auth?.metadata?.service_account_namespace ?
  'service' : 'user'`. The literal string `'unknown'` MUST NOT change
  classification.
- Bind `eventId` and `vaultRequestId` to a single computation:
  `const vaultId = entry?.request?.id ?? randomUUID(); const eventId =
  vaultId; const vaultRequestId = vaultId`. Both fields carry the same
  value when the Vault id is missing.

## Capabilities

### Modified Capabilities

- `secret-management`: publish-error observability and DLQ;
  namespace-vs-user classification; eventId / vaultRequestId binding.

## Impact

- **Affected code**:
  `services/secret-audit-handler/src/kafka-publisher.mjs`,
  `services/secret-audit-handler/src/vault-log-reader.mjs`,
  `services/secret-audit-handler/src/index.mjs` (handle re-thrown
  publish error in the for-await body).
- **Migration required**: Kafka topic `audit.dlq.secret-audit-publish`
  must exist.
- **Breaking changes**: previously-silent Kafka send failures now
  surface to logs, metrics, and the DLQ; downstream alerting may fire.
- **Out of scope**: idempotent producer (covered by
  `harden-m2-runtime-operations`); checkpoint advancement on publish
  failure (handled by `complete-m2-tail-and-checkpoint`'s checkpoint
  semantics).
