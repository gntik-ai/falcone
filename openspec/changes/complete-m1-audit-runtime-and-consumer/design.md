## Goals

1. `services/audit/` ships a single callable runtime — `emitAuditEvent` —
   that producers can import without re-implementing validation, routing,
   or masking.
2. At least one production consumer (the L1 backup-status emitter)
   exercises the runtime end-to-end so the contract has a real customer.
3. The canonical envelope from `observability-audit-event-schema.json` is
   enforced at runtime, not just declared.

## Non-goals

- **Migrating all six ad-hoc emitters** (D1, F3, H1, I1, K1 — L1 is
  in-scope). Each migration touches its own capability's audit shape and
  is tracked under separate `fix-*` proposals.
- **Building the query, export, and correlation surfaces.** Those
  consume the emitted events; they are sequenced after this change.
- **Replacing KafkaJS** or introducing a different transport. The
  canonical pipeline contract names Kafka and we keep it.
- **Backfilling historical audit events** into the canonical envelope.

## Module layout

```
services/audit/src/
  emit.mjs              # public entry: emitAuditEvent(envelope)
  schema-validator.mjs  # AJV wrapper around the JSON Schema
  masking-policy.mjs    # forbidden-field stripper
  topic-router.mjs      # envelope → topic string
  metrics.mjs           # freshness / transport / storage health gauges
  contract-boundary.mjs # (existing) re-exports — kept
  authorization-context.mjs # (existing) — kept
```

## Validation flow inside `emitAuditEvent`

1. `validateEnvelope(envelope)` — throws `AuditValidationError` on any
   missing required field, enum violation, or unknown property
   (`additionalProperties: false` is enforced).
2. `applyMaskingPolicy(envelope)` — recursively strips keys matching
   the forbidden-field list; returns a new envelope (no in-place
   mutation).
3. `routeTopic(envelope)` — returns `audit.${envelope.scope.tenant_id}`
   for tenant/tenant_workspace scope or `audit.platform` for platform
   scope.
4. `producer.send({ topic, messages: [...] })` with `key =
   envelope.scope.tenant_id ?? 'platform'` for partitioning per the
   canonical pipeline contract.
5. On success, increment the `in_falcone_audit_emission_freshness_seconds`
   gauge with `now - envelope.event_timestamp`.
6. On failure, record the error on the `in_falcone_audit_transport_health`
   gauge as `degraded` and re-throw.

## Reference consumer: backup-status

The L1 backup-status emitter currently calls Kafka directly with a
`'backup.*'` / `'restore.*'` flat shape. The migration:

- Maps `backup.*` events to canonical envelope:
  - `actor = { actor_id, actor_type: 'tenant_user' | 'platform_user' }`
  - `scope = { mode: 'tenant', tenant_id }`
  - `resource = { subsystem_id: 'backup', resource_type: 'snapshot',
    resource_id }`
  - `action = { action_id: 'backup.requested', category:
    'resource_creation' }` (mapped per event type)
  - `result = { outcome }`
  - `origin = { origin_surface: 'control_api', emitting_service:
    'backup-status' }`
  - `detail = { ...everything else }`
- Removes the direct `kafka.send(...)` call; calls
  `emitAuditEvent(envelope)` instead.

## Compatibility window

For one release, the L1 emitter publishes to both the legacy
`platform.audit.events` topic and the canonical `audit.<tenant_id>` topic.
Downstream consumers are notified to migrate; in the next release the
legacy topic is removed.

## Out-of-scope notes

This change does not address the topic-naming and partitioning violations
in D1, F3, H1, I1, K1 (tracked under
`fix-m1-topic-and-masking-enforcement` and per-capability `fix-*`
proposals). It does not address the `capabilityEnforcementDeniedEvent`
shape divergence (tracked under `fix-m1-canonical-envelope-conformance`).
