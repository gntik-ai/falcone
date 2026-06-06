## Why

Both CDC bridges allow a single environment variable to replace the entire Kafka topic name, collapsing per-tenant isolation. `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10` uses `process.env.PG_CDC_KAFKA_TOPIC_PREFIX ?? \`${captureConfig.tenant_id}.${captureConfig.workspace_id}.pg-changes\`` — when the env var is set it becomes the complete topic name, discarding tenant and workspace components. `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:5::resolveTopic` is identical for `MONGO_CDC_KAFKA_TOPIC_PREFIX`. An operator setting either variable routes all tenants' change events to a single shared topic, breaking Kafka-based tenant isolation entirely. Neither override value is validated at startup (iso-012 / bug-020). Secondary amplifier: `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs:19` loads all active capture configs from all tenants without a `tenant_id` predicate; `services/pg-cdc-bridge/src/CaptureConfigCache.mjs:8` scopes only by `data_source_ref` (bug-009 / bug-010 / bug-020 / bug-021 / iso-005 / iso-006).

## What Changes

- The Kafka topic for both PG and Mongo CDC bridges MUST always embed `tenant_id` AND `workspace_id`; no configuration may replace those components.
- If a namespace override is supported it MUST act only as a leading namespace prepended: `${namespace}.${tenant_id}.${workspace_id}.<suffix>`; the env-var-as-complete-topic behavior is removed.
- The namespace override value MUST be validated against a safe pattern (e.g., `^[a-z][a-z0-9._-]{0,63}$`) at startup; invalid values cause startup rejection.
- `MongoCaptureConfigCache.mjs:19` SHOULD add a `tenant_id` predicate; `CaptureConfigCache.mjs:8` SHOULD scope by `tenant_id` in addition to `data_source_ref`.

## Capabilities

### New Capabilities

- `change-data-capture`: Per-tenant Kafka topic isolation for PostgreSQL and MongoDB CDC bridges, ensuring change events are always routed to tenant-scoped topics and that no environment-variable override can collapse cross-tenant routing.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the change-data-capture capability spec -->

## Impact

- `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10` — rewrite: env var becomes validated namespace prefix only.
- `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:5::resolveTopic` — same rewrite and startup validation.
- `services/pg-cdc-bridge/src/CaptureConfigCache.mjs:8` — (SHOULD) add `tenant_id` predicate to SQL.
- `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs:19` — (SHOULD) add tenant-scoped predicate.
- BREAKING: deployments relying on the flat-topic override must migrate Kafka consumers to per-tenant/workspace topic naming.
- Black-box suite: new integration test verifying per-tenant topic routing when the namespace override is set.
