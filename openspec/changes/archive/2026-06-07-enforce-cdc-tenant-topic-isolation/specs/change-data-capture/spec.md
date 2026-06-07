## ADDED Requirements

### Requirement: CDC Kafka topic always embeds tenant and workspace identity

The system SHALL derive the Kafka topic for every CDC change event by always including `tenant_id` and `workspace_id` in the topic name. The system SHALL NOT allow any environment variable or configuration value to replace the `tenant_id` and `workspace_id` components of the topic name. If a namespace override is configured, the system SHALL treat it only as a validated leading prefix prepended to `${tenant_id}.${workspace_id}.<bridge-suffix>`, producing a topic of the form `${namespace}.${tenant_id}.${workspace_id}.<bridge-suffix>`.

#### Scenario: Namespace override does not collapse per-tenant topics in the PG bridge

- **WHEN** `PG_CDC_KAFKA_TOPIC_PREFIX` is set to `myns` and the PG CDC bridge publishes a change event for tenant `tenant-a` workspace `ws-1`
- **THEN** the Kafka topic used is `myns.tenant-a.ws-1.pg-changes`
- **AND** a change event for tenant `tenant-b` workspace `ws-2` is published to `myns.tenant-b.ws-2.pg-changes`

#### Scenario: Namespace override does not collapse per-tenant topics in the Mongo bridge

- **WHEN** `MONGO_CDC_KAFKA_TOPIC_PREFIX` is set to `myns` and the Mongo CDC bridge publishes a change event for tenant `tenant-a` workspace `ws-1`
- **THEN** the Kafka topic used is `myns.tenant-a.ws-1.mongo-changes`
- **AND** a change event for tenant `tenant-b` workspace `ws-2` is published to `myns.tenant-b.ws-2.mongo-changes`

#### Scenario: Events from different tenants never share a topic

- **WHEN** both bridges are running with no namespace override and events arrive for tenant `tenant-a` and tenant `tenant-b`
- **THEN** every change event for tenant `tenant-a` is published to a topic containing `tenant-a`
- **AND** no change event for tenant `tenant-a` is published to a topic containing `tenant-b`

### Requirement: Namespace override value is validated at startup

The system SHALL validate the namespace override value for both `PG_CDC_KAFKA_TOPIC_PREFIX` and `MONGO_CDC_KAFKA_TOPIC_PREFIX` at process startup against the pattern `^[a-z][a-z0-9._-]{0,63}$`. The system SHALL reject startup and emit a fatal error when the configured override value does not match this pattern.

#### Scenario: Invalid namespace override causes startup rejection in the PG bridge

- **WHEN** `PG_CDC_KAFKA_TOPIC_PREFIX` is set to a value that does not match `^[a-z][a-z0-9._-]{0,63}$` (e.g., `UPPER_CASE` or an empty string)
- **THEN** the PG CDC bridge process fails at startup with a fatal configuration error before processing any events

#### Scenario: Invalid namespace override causes startup rejection in the Mongo bridge

- **WHEN** `MONGO_CDC_KAFKA_TOPIC_PREFIX` is set to a value that does not match `^[a-z][a-z0-9._-]{0,63}$`
- **THEN** the Mongo CDC bridge process fails at startup with a fatal configuration error before processing any events

#### Scenario: Valid namespace override allows normal startup

- **WHEN** `PG_CDC_KAFKA_TOPIC_PREFIX` is set to a value matching the allowed pattern (e.g., `prod-ns`)
- **THEN** the PG CDC bridge starts successfully and routes events to per-tenant topics prefixed with `prod-ns`

### Requirement: Capture config queries are scoped to their owning tenant

The system SHALL scope capture config loading queries in both bridges to the relevant tenant, so that a single poll cannot return capture configs belonging to other tenants. The PostgreSQL bridge capture config cache SHALL include a `tenant_id` predicate in its SQL query. The MongoDB bridge capture config cache SHALL include a `tenant_id` or equivalent data-source predicate so that it does not load configs for all tenants in a single unbounded query.

#### Scenario: Mongo capture config cache does not return configs for other tenants

- **WHEN** the MongoDB CDC bridge polls for active capture configs while multiple tenants have active configs
- **THEN** the configs returned are scoped to the relevant tenant or data source
- **AND** configs belonging to a different tenant are not loaded into the same cache entry

#### Scenario: PG capture config cache is scoped by tenant

- **WHEN** the PostgreSQL CDC bridge loads capture configs from `services/pg-cdc-bridge/src/CaptureConfigCache.mjs`
- **THEN** the SQL query includes a `tenant_id` predicate
- **AND** configs for tenants other than the operating tenant are not returned
