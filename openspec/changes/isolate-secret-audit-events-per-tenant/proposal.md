## Why

`services/secret-audit-handler/src/index.mjs:7` reads a single static Kafka topic at startup (`process.env.SECRET_AUDIT_KAFKA_TOPIC ?? 'console.secrets.audit'`) and creates one publisher instance (line 14) bound to that topic. The tailer loop at lines 31-34 publishes every Vault audit entry to this single topic with no per-tenant routing or filtering.

`services/secret-audit-handler/src/kafka-publisher.mjs:19-29` sets the Kafka message key to `event.domain` — a coarse label (`platform|tenant|functions|gateway|iam`). A message key controls partition assignment only; it does not isolate consumers. Any subscriber to `console.secrets.audit` reads the full audit stream for every tenant.

`services/secret-audit-handler/src/event-schema.mjs:3-28` (`SecretAuditEvent`) has no `tenantId` property and `additionalProperties: false` prevents unenforced ad-hoc addition. `services/secret-audit-handler/src/vault-log-reader.mjs::parseVaultEntry` extracts `domain` and `secretName` from the Vault path but does not extract `tenantId` — even though for `domain === 'tenant'` the path is `tenant/<tenantId>/...` and `tenantId = rest[0]` is recoverable. The sanitizer strips secret values but leaves `operation`, `secretPath`, `requestorIdentity`, and `result`, which alone leak each tenant's secret access patterns to any cross-tenant consumer.

The correct per-tenant topic pattern is demonstrated by `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10` using `${tenant_id}.${workspace_id}.pg-changes` (source finding `bug-008 / iso-004`).

## What Changes

- Extract `tenantId` in `vault-log-reader.mjs::parseVaultEntry` for `domain === 'tenant'` entries: `tenantId = rest[0]`.
- Add a nullable `tenantId` field to `SecretAuditEvent` in `event-schema.mjs` and update `validateAuditEvent`.
- Route tenant-domain events to `console.secrets.audit.<tenantId>`; route non-tenant-domain events to `console.secrets.audit.platform`. Never publish a tenant-domain event to the shared `console.secrets.audit` topic.
- Update `kafka-publisher.mjs` to accept a dynamic topic per event, and update `index.mjs` to compute the target topic at dispatch time.
- Retain `event.domain` as the partition key within each topic.
- BREAKING: existing consumers of the shared `console.secrets.audit` topic must migrate to per-tenant topics.

## Capabilities

### New Capabilities

- `secrets`: Per-tenant Kafka topic isolation for secret audit events so that a subscriber to one tenant's topic cannot receive audit events for any other tenant.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the secrets capability spec -->

## Impact

- `services/secret-audit-handler/src/index.mjs` — remove single static topic; compute per-tenant topic name at dispatch time.
- `services/secret-audit-handler/src/kafka-publisher.mjs` — accept dynamic topic per event; route accordingly.
- `services/secret-audit-handler/src/vault-log-reader.mjs::parseVaultEntry` — extract `tenantId` for `domain === 'tenant'` entries.
- `services/secret-audit-handler/src/event-schema.mjs:3-28` — add nullable `tenantId` field to `SecretAuditEvent`.
- BREAKING consumer-contract change: existing subscribers of `console.secrets.audit` must be audited and migrated before deployment.
- Black-box / integration test: tenant A's audit events do not appear on tenant B's topic.
