## Why

The secret-audit handler publishes to a topic and partition key that
match neither the M1 canonical pipeline contract nor any tenant-isolation
discipline. From `openspec/audit/cap-m2-secret-audit-pipeline.md`:

- **B9** (`services/secret-audit-handler/src/index.mjs:7`) — default
  topic `'console.secrets.audit'` is yet another convention (six+
  conventions in the repo) and does not match the M1 canonical
  `audit.<tenant_id>` / `audit.platform`.
- **B10** (`services/secret-audit-handler/src/kafka-publisher.mjs:22`)
  — `key: event.domain` partitions by the operational domain (5
  values). All secrets across all tenants land in one of 5 partitions;
  tenant isolation is absent.
- **G4** — M1 canonical pipeline contract declares partitioning by
  `tenant_id`; M2 ignores this.
- **G10** — secrets pipeline carries no `tenant_id` field in the
  canonical envelope, breaking the partitioning rule by design.

## What Changes

- Change the default topic to `audit.platform` (since secret-audit
  events are subsystem-level platform events, not tenant-scoped) and
  document that consumers may subscribe per-tenant via separate
  `audit.<tenant_id>` topics once the canonical M1 emitter is
  in place.
- Add a `tenantId` field to the secret-audit event envelope, sourced
  from Vault's `auth.metadata.tenant_id` when present (falling back to
  `'platform'` for platform-level secret operations).
- Change the Kafka message `key` from `event.domain` to
  `event.tenantId ?? 'platform'` so partitioning matches the canonical
  pipeline contract.
- Wire the M1 `routeTopic(envelope)` helper (per
  `fix-m1-topic-and-masking-enforcement`) at the publish boundary so
  the topic and key derive from one canonical function.

## Capabilities

### Modified Capabilities

- `secret-management`: secret-audit topic name, partitioning key, and
  tenant-id propagation through the envelope.

## Impact

- **Affected code**: `services/secret-audit-handler/src/index.mjs`,
  `services/secret-audit-handler/src/kafka-publisher.mjs`,
  `services/secret-audit-handler/src/vault-log-reader.mjs`,
  `services/secret-audit-handler/src/event-schema.mjs` (add `tenantId`
  to required-field list and YAML).
- **Migration required**: downstream consumers of
  `console.secrets.audit` must re-subscribe to `audit.platform` (or
  `audit.<tenant_id>` per tenant); update Helm values to set
  `SECRET_AUDIT_KAFKA_TOPIC` if the deployment relies on the default.
- **Breaking changes**: topic name and partition key both change;
  consumers that hard-coded `console.secrets.audit` must migrate.
- **Out of scope**: per-emitter migration of D1/F3/H1/I1/K1 (separate
  M1 work); checkpoint and tail-loop semantics
  (`complete-m2-tail-and-checkpoint`).
