## Why

Several smaller defects collectively make the handler hard to operate:
unknown Vault operations are silently coerced to `'read'`, KafkaJS
internals are silenced, retries are not idempotent, sequential awaits
hide back-pressure, and SIGTERM exits 0 regardless of disconnect
failure. From `openspec/audit/cap-m2-secret-audit-pipeline.md`:

- **B13** (`services/secret-audit-handler/src/vault-log-reader.mjs:33-37`)
  — `mapOperation` defaults unknown operations to `'read'`. New Vault
  operations (`list`, `patch`, `rollback`) are silently labelled
  `'read'`. Consumers see a read where there was a write.
- **B15** (`services/secret-audit-handler/src/kafka-publisher.mjs:7`) —
  KafkaJS `logLevel: NOTHING` suppresses all internal diagnostics.
  Broker switches, connection resets, and retries are invisible.
- **B16** (`kafka-publisher.mjs:10`) — no `idempotent: true` on the
  producer. KafkaJS retries (5x) without idempotency may publish
  duplicates.
- **B17** (`index.mjs:31-34`) — sequential `await publishAuditEvent`
  inside the for-await. A slow Kafka makes the handler lag without
  surfacing back-pressure.
- **B18** (`index.mjs:23-25`) — SIGTERM handler awaits
  `publisher.disconnect()` and exits 0 even when the disconnect
  rejects; failed shutdowns appear clean.
- **G3** — package script is a placeholder for some commands.
- **G22** — no `idempotent` producer.
- **G23** — no broker-diagnostic logging.

## What Changes

- Replace the default `'read'` fallback in `mapOperation` with a throw
  (`UnknownVaultOperationError`) routed to the parse-error DLQ; new
  Vault operations surface immediately.
- Raise KafkaJS `logLevel` to `INFO`; wire its `logCreator` to the
  service's pino logger so broker events appear in structured logs.
- Set `idempotent: true` on the KafkaJS producer; `transactionalId`
  derived from the service instance id so retries dedupe per producer.
- Change the for-await body to a bounded-concurrency window
  (`p-limit`-style, default 8) so a slow Kafka surfaces as growing
  in-flight gauge; back-pressure is observable.
- Fix the SIGTERM handler at `index.mjs:23-25` to exit non-zero when
  `publisher.disconnect()` rejects so orchestrators (k8s) observe the
  failure.

## Capabilities

### Modified Capabilities

- `secret-management`: unknown-operation handling, KafkaJS logging and
  idempotence, concurrency / back-pressure, and shutdown exit code.

## Impact

- **Affected code**:
  `services/secret-audit-handler/src/vault-log-reader.mjs`,
  `services/secret-audit-handler/src/kafka-publisher.mjs`,
  `services/secret-audit-handler/src/index.mjs`, new dependency
  `p-limit` and a pino logger.
- **Migration required**: none.
- **Breaking changes**: unknown Vault operations now route to DLQ
  (previously silently labelled `'read'`); operators may see new DLQ
  traffic on the first run after the upgrade.
- **Out of scope**: max-line-size DoS guard (B19), max-depth sanitiser
  guard (B20), checkpoint internals (covered by
  `complete-m2-tail-and-checkpoint`).
