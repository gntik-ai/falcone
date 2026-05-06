# Tasks — wire-tenant-lifecycle-event-emission

Each task is implementable independently in Codex CLI. The first task always confirms baseline green per `openspec/AGENTS.md` § "Working style with the split-tool workflow".

## T01 — Confirm baseline green

**What.** Confirm `corepack pnpm validate:repo`, `corepack pnpm lint`, and `corepack pnpm test:unit` are green on the branch's starting commit, before any change in this proposal is applied.

**Acceptance.**

- All three commands exit 0.
- `git status` reports a clean working tree.

**Test target.** `corepack pnpm test:unit` (already part of the validators).

## T02 — Add `LIFECYCLE_EVENT_EMISSION` feature flag

**What.** Add `TENANT_LIFECYCLE_EVENT_EMISSION_ENABLED` to the control-plane environment configuration (default `false`). Document the flag in the deployment topology.

**Acceptance.**

- The flag reads from `process.env.TENANT_LIFECYCLE_EVENT_EMISSION_ENABLED` and defaults to `false`.
- The flag is referenced in `charts/in-falcone/values.yaml` (or the equivalent values fragment) with the default `false` and a comment pointing to this proposal.
- `validate:deployment-chart` continues to pass.

**Test target.** A unit test under `tests/unit/` that asserts the flag default is `false` and that `true` enables emission paths added in T06–T08.

## T03 — Define the canonical lifecycle event envelope contract

**What.** Add `services/internal-contracts/src/tenant-lifecycle-event.json` (one JSON Schema covering the 12 event types) — or extend the existing `domain-model.json` with a dedicated envelope sub-schema — and export it from `services/internal-contracts/src/index.mjs`.

**Acceptance.**

- The envelope declares `event_id` (UUID v4), `event_type` (enum of the 12 canonical values), `schema_version` (`"1.0"`), `correlation_id`, `tenant_id`, optional `workspace_id`, `actor_id`, `actor_type` ∈ {`platform_user`, `service_account`, `platform_break_glass`}, `before_state`, `after_state` (both nullable strings), `idempotency_key`, `emitted_at` (RFC 3339).
- `event_type` enum matches exactly the values in `services/internal-contracts/src/domain-model.json`.
- A validator under `scripts/` ensures the envelope and `domain-model.json` event vocabulary stay in lock-step.

**Test target.** New tests under `tests/contracts/` that load the envelope schema and validate one fixture per `event_type`.

## T04 — Add the dedupe table for emission idempotency

**What.** Add a migration `services/provisioning-orchestrator/src/migrations/<NNN>-tenant-lifecycle-event-dedupe.sql` creating `tenant_lifecycle_event_dedupe(tenant_id TEXT, event_type TEXT, idempotency_key TEXT, emitted_at TIMESTAMPTZ, PRIMARY KEY(tenant_id, event_type, idempotency_key))`.

**Acceptance.**

- Migration is idempotent (`CREATE TABLE IF NOT EXISTS`).
- `validate:adr:postgres` continues to pass.
- A repository module `services/provisioning-orchestrator/src/repositories/tenant-lifecycle-event-dedupe-repo.mjs` exposes `markEmitted({ tenantId, eventType, idempotencyKey })` returning `false` on duplicate insert.

**Test target.** Adapter test under `tests/adapters/` against a real Postgres instance.

## T05 — Add the Kafka producer wiring in the control plane

**What.** Add a producer wrapper `apps/control-plane/src/tenant-lifecycle-event-publisher.mjs` that takes an envelope, validates it against the contract from T03, checks the dedupe table from T04, and publishes to the canonical topic. Configuration: `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_TENANT_LIFECYCLE_TOPIC` (default `tenant.lifecycle`).

**Acceptance.**

- Validation failures return a structured error (`code: "ENVELOPE_INVALID"`) and DO NOT publish.
- Dedupe hits return `{ deduped: true }` and DO NOT publish.
- Successful publish returns `{ event_id, partition, offset }`.
- A unit test stubs the Kafka client and asserts the dedupe + validation flow.

**Test target.** Unit tests under `tests/unit/`.

## T06 — Wire `tenant.*` emission

**What.** Extend `apps/control-plane/src/tenant-management.mjs` (or add `tenant-manager.mjs`) so that:

- `POST /v1/tenants` emits `tenant.created` after the orchestrator saga `completed`.
- `PUT /v1/tenants/{tenantId}` (when transitioning through `provisioning → active`) emits `tenant.activated`.
- `POST /v1/tenants/{tenantId}/iam-access` with `suspend` emits `tenant.suspended`; with `reactivate` it does NOT emit `tenant.activated` (use a dedicated `tenant.access.reactivated` if needed — out of scope here).
- `DELETE /v1/tenants/{tenantId}` emits `tenant.soft_deleted`.

Emission is gated by the feature flag from T02.

**Acceptance.**

- Each handler invokes the publisher exactly once per terminal-saga success.
- Failed sagas do not emit.
- A contract test under `tests/contracts/` covers each of the 4 transitions.

**Test target.** `corepack pnpm test:contracts`.

## T07 — Wire `tenant_membership.*` emission

**What.** Extend the membership write paths so that:

- `POST /v1/tenants/{tenantId}/memberships` emits `tenant_membership.created` after success.
- Transitions through the membership state machine (`activated`, `suspended`, `soft_deleted`) each emit the corresponding event.

**Acceptance.**

- Identical envelope shape to T06.
- Workspace-membership counterparts (`workspace_membership.*`) are NOT emitted by this capability.

**Test target.** `corepack pnpm test:contracts`.

## T08 — Wire `invitation.*` emission

**What.** Extend the invitation write paths so that:

- `POST /v1/tenants/{tenantId}/invitations` emits `invitation.created`.
- `POST /v1/tenants/{tenantId}/invitations/{invitationId}/acceptance` emits `invitation.activated` (and triggers T07's `tenant_membership.created`).
- `POST /v1/tenants/{tenantId}/invitations/{invitationId}/revocation` and TTL expiry emit `invitation.suspended`.
- `invitation.soft_deleted` is emitted by the retention sweeper.

**Acceptance.**

- Revoked or expired invitations cannot mint memberships afterwards (REQ-TEN-03).
- `invitation.suspended` carries the reason (`revoked` | `expired`).

**Test target.** `corepack pnpm test:contracts`.

## T09 — Add the `validate:tenant-lifecycle-events` validator

**What.** Add `scripts/validate-tenant-lifecycle-events.mjs` and wire it into `validate:repo`. The validator must:

- enumerate every saga workflow under `services/provisioning-orchestrator/src/workflows/` whose declared resource type is `tenant`, `tenant_membership`, or `invitation`;
- assert that each has a corresponding emission step in the control-plane handler matrix from T06–T08;
- assert that the `event_type` enum in `domain-model.json` matches the publisher's accepted set.

**Acceptance.**

- Validator exits non-zero if any of the 12 transitions is missing an emission wiring.
- Validator exits non-zero if `domain-model.json` declares an event type the publisher does not know about.
- Added to the `validate:repo` script chain in `package.json`.

**Test target.** `corepack pnpm validate:repo`.

## T10 — Update the spec and remove the change-proposal trace

**What.** When T01–T09 land green, regenerate `openspec/specs/tenant-lifecycle/spec.md` REQ-TEN-09:

- Drop the "(planned)" framing; mark the requirement as implemented.
- Remove the `openspec/changes/wire-tenant-lifecycle-event-emission/proposal.md` entry from REQ-TEN-09's `Trace.` line.
- Add the new contract path (`services/internal-contracts/src/tenant-lifecycle-event.json` — or whatever T03 produces) to the `Internal contracts` Surfaces list.
- Move this change proposal to `openspec/archive/2026-05/wire-tenant-lifecycle-event-emission/` per `openspec/conventions.md` § "Archival".

**Acceptance.**

- The spec validates with `openspec validate --all --strict` (when the validator is wired up).
- `git tag openspec-archive/wire-tenant-lifecycle-event-emission` is applied to the archival commit.

**Test target.** Manual review of the spec diff in the archival PR.
