## Context

Falcone's tenant provisioning is a saga coordinated by
`services/provisioning-orchestrator`. Each domain has an applier module
(`iam-applier.mjs`, `kafka-applier.mjs`, `postgres-applier.mjs`,
`mongo-applier.mjs`, `storage-applier.mjs`, `functions-applier.mjs`) that
currently exports only an `apply` function. The orchestrator's sweep actions
(e.g. `credential-rotation-expiry-sweep.mjs`) demonstrate the pattern for
scheduled teardown work: query eligible records, validate preconditions, perform
side-effectful work, emit an audit event.

The full purge lifecycle is already modeled in internal-contracts:
`evaluateTenantLifecycleMutation` enforces preconditions (retention window,
export checkpoint, elevated access, dual confirmation) and
`buildTenantPurgeDraft` constructs the parameters. The `state='purged'`
transition is defined. What is missing is the execution layer.

## Goals / Non-Goals

**Goals:**
- Automated scheduled sweep that purges eligible deleted tenants.
- On-demand operator purge endpoint.
- Symmetric `teardown` export on all six appliers.
- `tenant.purged` audit event with destruction manifest.
- No orphaned data in any domain after a successful purge.

**Non-Goals:**
- Soft-delete (already implemented).
- Partial-domain purge (purge is always all-or-nothing; partial failures retry).
- Cross-tenant data migration — purge removes, it does not move.
- UI for the purge workflow (operator CLI / API only in this change).

## Decisions

**D1 — Saga with compensating-action pattern, not a simple DELETE.**
Rationale: each domain adapter (Keycloak, Kafka, Postgres, Mongo, MinIO,
OpenWhisk) has different error semantics and requires ordered teardown. A saga
that records each step in the async-operation log allows safe retry without
double-deletion. Alternatively, a two-phase "mark then sweep" was considered but
requires an additional state machine; the existing async-operation machinery
covers the saga pattern already.

**D2 — Reuse existing `evaluateTenantLifecycleMutation` as the gate, never bypass.**
Rationale: the precondition logic (retention window, export checkpoint, elevated
access, dual confirmation) is already tested and audited. Duplicating it in the
sweep action would create drift. The sweep calls `evaluateTenantLifecycleMutation`
and aborts if `allowed=false`.

**D3 — `teardown` is a new named export, not an optional parameter on `apply`.**
Rationale: keeping apply and teardown as distinct exports makes the contract
explicit and prevents accidental teardown by misuse of the apply path. It also
makes the teardown path independently testable.

**D4 — Destruction manifest as a structured JSON field on the audit event.**
Rationale: compliance and audit requirements (right-to-erasure verification)
demand a verifiable record. The manifest is an array of
`{ domain, resourceType, resourceId, status }` objects included in the
`tenant.purged` event payload.

**D5 — On-demand endpoint returns 202 Accepted + async-operation reference.**
Rationale: purge is a long-running multi-step operation; synchronous HTTP
response would be unreliable. The existing async-operation pattern (used by all
provisioning mutations) is the right abstraction.

## Risks / Trade-offs

**Risk: Irreversibility — a bug in teardown could destroy live tenant data.**
Mitigation: (1) Dual-confirmation guard enforced at every entry point. (2) Export
checkpoint required before purge is allowed. (3) Saga step logging allows post-hoc
audit of what was removed. (4) Integration tests use isolated fixture tenants.
(5) Code-reviewed by at least two engineers before merge.

**Risk: Partial failure leaves inconsistent multi-domain state.**
Mitigation: Saga records step outcomes in the async-operation log; incomplete
sagas do not emit `tenant.purged` and are retryable. The sweep re-evaluates
eligibility on each run — idempotent teardown (delete-if-exists semantics on each
applier) prevents double-delete errors.

**Risk: Long-running saga holds DB connections.**
Mitigation: each applier step is transactionally isolated; the orchestrator uses
step-by-step commits rather than a single long transaction.

## Migration Plan

1. Ship `teardown` exports on all six appliers behind a feature flag; default off.
2. Ship `tenant-purge-sweep.mjs` action registered with the scheduler but in
   `dry_run` mode: logs what would be purged without executing teardown.
3. After 2-week dry-run observation period with zero unexpected candidates, flip
   to `live` mode.
4. Wire `POST /v1/admin/tenants/{tenantId}/purge` endpoint (on-demand path) in
   the same release as live mode.
5. Backfill audit: run a one-time query to report tenants already past
   `purgeEligibleAt`; review before enabling live mode.
