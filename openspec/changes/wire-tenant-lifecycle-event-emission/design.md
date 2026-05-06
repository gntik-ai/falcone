# Design — wire-tenant-lifecycle-event-emission

## Why split emission ownership

The provisioning orchestrator already emits saga-internal events (`operation-cancel-event.json`, `operation-recovery-event.json`, `operation-retry-event.json`, `operation-timeout-event.json`, `manual-intervention-required-event.json`, `intervention-notification-event.json`, `failure-classified-event.json`, `idempotency-dedup-event.json`) and the tenant-config admin events (`config.export.completed`, `config.reprovision.completed`, `config.reprovision.identifier_map.generated`, `config.preflight.completed`). These are *mechanics* events: they describe what the orchestrator did, not what the business state became.

Adding business-level lifecycle emission to the orchestrator would conflate two roles:

- **Mechanics:** "this saga step ran, this retry happened, this saga completed."
- **Semantics:** "this tenant was created, this membership was activated."

Mixing them creates two problems:

1. The orchestrator emits saga-internal events at every step transition. If business-level events were also emitted by the orchestrator, the emission point would have to look at the saga's *terminal* state — which is exactly the role of the control-plane handler that called the saga in the first place.
2. A future migration to event sourcing or to an outbox-pattern publisher would touch the orchestrator's hot path. Keeping business emission in the control-plane handler localises the change to the per-route surface.

The control-plane handler is therefore the natural emission point: it owns the request, it has the actor and correlation context, and it runs *after* the orchestrator confirms the saga reached `completed`.

## Why a `tenant-manager` module instead of extending `tenant-management.mjs`

`apps/control-plane/src/tenant-management.mjs` today is a contract registry: it imports from `services/internal-contracts/src/index.mjs` and `services/adapters/src/storage-tenant-context.mjs` and exports preview / summarisation helpers. There are no Fastify route handlers and no runtime side effects.

Two options for the new emission code:

1. **Extend `tenant-management.mjs`.** Pro: one module to read. Con: mixes pure contract registration with runtime side effects (Kafka producer, dedupe-table reads).
2. **Add `tenant-manager.mjs` as the runtime companion.** Pro: clean separation between contract surface (`tenant-management.mjs`) and runtime emission (`tenant-manager.mjs`). Con: two modules to wire.

We pick option 2. It mirrors the IAM split (`iam-admin.mjs` is a contract registry; the runtime emission for `iam_lifecycle_event` will follow the same pattern) and keeps the contract-registry modules side-effect-free for testability.

## Envelope shape and topic routing

Single canonical topic `tenant.lifecycle` (configurable via `KAFKA_TENANT_LIFECYCLE_TOPIC`). All 12 event types share the same topic with `event_type` as the discriminator.

Trade-off considered: one topic per event-type family (`tenant`, `tenant_membership`, `invitation`). Rejected for v1 because:

- Audit pipeline (OBS) already supports schema-discriminated single-topic streams.
- Three topics multiplies partitioning costs and ACL complexity.
- The audit query surface filters on `event_type`, not on topic, so consumers do not benefit from topic-level fan-out.

If consumer pressure later requires fan-out, splitting is additive: add the new topics, dual-publish for one release, then drop the shared topic.

Envelope (per T03):

```jsonc
{
  "event_id": "uuid-v4",
  "event_type": "tenant.created",
  "schema_version": "1.0",
  "correlation_id": "...",
  "tenant_id": "ten_...",
  "workspace_id": null,
  "actor_id": "usr_...",
  "actor_type": "platform_user",
  "before_state": null,
  "after_state": "draft",
  "idempotency_key": "...",
  "emitted_at": "2026-05-06T12:00:00.000Z"
}
```

`workspace_id` is set on `workspace_membership.*` events emitted by `workspace-management` (out of scope here) and on tenant-scoped events that are workspace-aware (none in this proposal). For the 12 event types in scope, `workspace_id` is always `null`.

## Idempotency: dedupe table vs orchestrator state

Two ways to dedupe:

1. Read the orchestrator's idempotency-key store (`075-idempotency-retry-tables.sql`) before publish and skip if the key has already produced a terminal saga outcome.
2. Maintain a separate `tenant_lifecycle_event_dedupe` table keyed on `(tenant_id, event_type, idempotency_key)`.

Option 1 looks attractive because it reuses existing state. We pick option 2 anyway:

- The orchestrator's idempotency key is per-saga, not per-emission. A saga can report `completed` multiple times if the handler retries the *poll* call, and we want emission to be idempotent regardless of the orchestrator's own retry semantics.
- Decoupling emission idempotency from saga idempotency means the publisher can be tested in isolation and a future event-sourcing migration can replace the orchestrator without touching emission.
- The dedupe table is small (one row per emitted event, indexable by `tenant_id`); retention is bounded by the standard tenant retention policy.

## Failure handling

If the publisher fails after the saga `completed` (Kafka unreachable, schema validation race), the handler:

1. Logs a structured error including the envelope.
2. Returns success to the API caller (the saga *did* complete).
3. Records a `manual_intervention_required` event via the orchestrator's existing pipeline so OBS can alert.
4. Does NOT mark the dedupe row, so a retry can re-publish.

This trades at-least-once delivery on the canonical topic for a never-stuck handler — the alternative (rolling back the saga because emission failed) would silently undo successful tenant operations.

## Backfill (out of scope, recorded for traceability)

Existing tenants in `active`, `suspended`, `soft_deleted` states will not retroactively emit `tenant.*` events. If a downstream consumer needs them, a separate one-shot backfill change proposal can scan the tenant tables and synthesise events with `before_state: null`, `idempotency_key: backfill-<tenant_id>-<event_type>`, and a dedicated `actor_type: "platform_break_glass"` so consumers can distinguish backfill from live emission.

## Out-of-scope cross-capability work

- **`realtime-and-events`** must create the `tenant.lifecycle` topic and ACL so the control-plane producer principal can write to it. This is captured in `realtime-and-events`'s spec (forthcoming) as a topic-creation requirement consumed by TEN.
- **`observability-and-audit`** must register a consumer that ingests the `tenant.lifecycle` topic into the audit pipeline. Captured under OBS's spec (forthcoming).
- **`identity-and-access`** has the same emission gap for `iam_lifecycle_event` (REQ-IAM-08). The pattern in this proposal (envelope + dedupe + post-saga emission) is reusable; a parallel change proposal `wire-iam-lifecycle-event-emission` can copy this design once IAM's spec lands.
