## Why

The `mongo-cdc-bridge` lets a test env var silently override the production
Mongo connection and uses a misnamed Kafka topic env var that collapses
every tenant to one topic. From `openspec/audit/cap-e2-mongo-cdc-bridge.md`:

- **B2** (`services/mongo-cdc-bridge/src/index.mjs:27`) — the
  `mongoClientFactory` does
  `MongoClient.connect(config.mongo_uri ?? process.env.MONGO_TEST_URI ??
  process.env.MONGO_URI)`. The presence of `MONGO_TEST_URI` overrides
  `MONGO_URI`. A test env var leaking into production silently overrides
  the production connection; production change capture would point at the
  test cluster, with no log warning of the precedence.
- **B3** (`services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:5`) —
  `process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX ??
  \`${tenant_id}.${workspace_id}.mongo-changes\``. Same defect as D2: the
  env var named "prefix" actually **replaces** the topic. A deployer
  setting `MONGO_CDC_KAFKA_TOPIC_PREFIX="my-prefix"` routes every
  tenant's events to the single topic `my-prefix` — cross-tenant data
  leak via misconfiguration.
- **G14** — same as B2, called out as a separate finding.

## What Changes

- Remove `MONGO_TEST_URI` from the production precedence chain in
  `mongoClientFactory`. The chain becomes
  `config.mongo_uri ?? process.env.MONGO_URI`. `MONGO_TEST_URI` is only
  honoured when `NODE_ENV === 'test'` AND emits a startup warning log
  even there.
- Rename the topic env to follow the same convention as
  `fix-d2-publisher-and-config`: introduce
  `MONGO_CDC_KAFKA_TOPIC_PREFIX` that composes
  (`<prefix>.<tenant>.<workspace>.mongo-changes`) and a separate
  `MONGO_CDC_KAFKA_TOPIC_OVERRIDE` for the single-topic kill-switch
  (with a startup warning).
- Helm chart values updated to reflect the new env vars; a deprecation
  shim detects the old single-value semantic and warns.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: mongo-cdc Mongo connection env precedence and
  Kafka topic-naming contract.

## Impact

- **Affected code**: `services/mongo-cdc-bridge/src/index.mjs`,
  `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs`,
  `services/mongo-cdc-bridge/helm/mongo-cdc-bridge/values.yaml`,
  `services/mongo-cdc-bridge/README.md`.
- **Migration required**: deployments setting `MONGO_CDC_KAFKA_TOPIC_PREFIX`
  with the old "this replaces the whole topic" intent MUST switch to
  `MONGO_CDC_KAFKA_TOPIC_OVERRIDE`. The default unchanged.
- **Breaking changes**: deployments accidentally relying on
  `MONGO_TEST_URI` to override the production connection will fail at
  boot (no `MONGO_URI` configured); this is the intended outcome — the
  prior behaviour was a footgun.
- **Out of scope**: cleaning up other `_TEST_*` env vars across services
  — those are tracked under their own capability audits.
