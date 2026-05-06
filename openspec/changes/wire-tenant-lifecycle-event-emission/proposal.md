# Wire tenant lifecycle event emission

## Why

`openspec/specs/tenant-lifecycle/spec.md` REQ-TEN-09 mandates that every tenant, tenant-membership, and invitation state transition emit the canonical lifecycle event declared in `services/internal-contracts/src/domain-model.json` (`tenant.{created,activated,suspended,soft_deleted}`, `tenant_membership.*`, `invitation.*`). Today these events are only declared as a contract: no backend module emits them. The provisioning orchestrator emits *saga-internal* events (operation-cancel, operation-recovery, etc.) and the *tenant-config admin* events (`console.config.export.completed`, etc.), but never the canonical business-level lifecycle events. The control-plane module `apps/control-plane/src/tenant-management.mjs` is a contract registry — it exposes contract surfaces but does not run a Fastify handler with a Kafka producer.

Without this wiring the audit pipeline (OBS), billing/quota observers (QTA), workspace cascade logic (WSP), and downstream provisioning consumers cannot react to tenant state changes. Q-TEN-04 / Q-TEN-05 were both resolved on 2026-05-06 to land this wiring.

## Scope

In scope:

- Add a `tenant-manager` handler module in `apps/control-plane/src/` (or extend `tenant-management.mjs`) that owns:
  - the request handling for every `/v1/tenants/...` write operation;
  - synchronous coordination with `services/provisioning-orchestrator` (idempotency-key dispatch, saga status polling);
  - the emission of canonical business-level lifecycle events (`tenant.*`, `tenant_membership.*`, `invitation.*`) on terminal-saga success.
- Wire a Kafka producer in the control-plane that publishes the canonical events to dedicated topics (one topic per `event_type` family or one shared topic with `event_type` discriminator — to be decided in `design.md`).
- Add the event envelope shared with `domain-model.json` event vocabulary: `event_id`, `event_type`, `schema_version`, `correlation_id`, `tenant_id`, optional `workspace_id`, `actor_id`, `actor_type`, `before_state`, `after_state`, `emitted_at`, `idempotency_key`.
- Add a repository-level validator (`scripts/validate-tenant-lifecycle-events.mjs`) that ensures every saga workflow that owns a tenant/membership/invitation state transition has a corresponding business-level event emission step.
- Add contract tests under `tests/contracts/` that:
  - assert each emitted event matches its `domain-model.json` event-type schema;
  - assert replays under the same idempotency key emit at most one event;
  - assert failed transitions emit zero business-level events.

Out of scope:

- IAM lifecycle events (REQ-IAM-08) — owned by `identity-and-access`, separate change proposal.
- Workspace, external-application, service-account, managed-resource lifecycle events — owned by `workspace-management`, separate change proposal.
- Topic creation in Kafka and ACL wiring — owned by `realtime-and-events` (will be consumed as a dependency).
- Audit pipeline storage of these events — owned by `observability-and-audit` (will be consumed as a dependency).

## Non-goals

- Refactoring `services/provisioning-orchestrator` to emit business-level events — explicitly rejected. The orchestrator keeps its saga-internal event role; emission ownership stays in the control-plane handler so a future event sourcing migration only touches one module.
- Backfilling lifecycle events for tenants that already exist (`active`, `suspended`, `soft_deleted` rows in the tenant tables). A separate one-shot backfill change proposal can land later if downstream consumers need it.
- Adding a new admin UI for the events. The audit pipeline (OBS) and the tenant governance dashboard already surface this state.

## Exit criteria

- `corepack pnpm validate:repo` passes including the new `validate:tenant-lifecycle-events` validator.
- `corepack pnpm test:contracts` includes new contract tests that prove the emission contract for each of the 12 canonical event types declared in `domain-model.json` (4 × `tenant.*`, 4 × `tenant_membership.*`, 4 × `invitation.*`).
- Manual smoke check: creating a tenant via `POST /v1/tenants` followed by `GET /v1/tenants/{id}/workflow-jobs/{jobRef}` reaching `completed` results in exactly one `tenant.created` event on the canonical topic.
- The audit pipeline (OBS) consumes the new topics without errors (verified via `tests/e2e/observability`).
- `openspec/specs/tenant-lifecycle/spec.md` REQ-TEN-09 is upgraded from "(planned)" to "(implemented)" and the spec is regenerated to drop the change-proposal trace line.

## Risks

- **Double emission on retry.** If the control-plane handler crashes after emission but before responding, the client retries with the same idempotency key and may trigger a second emission. Mitigated by a dedupe table keyed on `(tenant_id, event_type, idempotency_key)` checked before publish.
- **Event-before-commit.** If the handler publishes before the tenant write commits, a consumer can observe an event for a state that never persisted. Mitigated by emitting only after the orchestrator marks the saga `completed` (terminal success), which itself only happens after the database commit.
- **Topic provisioning lag.** The tenant-manager handler depends on `realtime-and-events` having created the canonical topics and ACLs. Mitigated by treating missing topics as a `manual_intervention_required` event from the orchestrator.
- **Schema drift.** If `domain-model.json` adds a field, the emitted events drift from the contract. Mitigated by the new contract test running on every PR via `corepack pnpm test:contracts`.

## Rollback

- Feature flag `TENANT_LIFECYCLE_EVENT_EMISSION_ENABLED` (default `false` until the change is fully validated). When `false`, the handler skips event emission but every other behaviour is preserved.
- The dedupe table is additive; rolling back the feature flag does not require schema changes.
- Topics are owned by `realtime-and-events`; rollback does not delete them, only stops emission.
