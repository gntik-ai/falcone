## Context

The workspace capability catalog endpoint exists at the gateway, the handler
exists, the response contract exists, and a migration seeding six capabilities
exists. None of them are connected. The default action factory at
`services/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs:97`
constructs `main` with neither `fetchCapabilities` nor a real `emitAuditEvent`,
so every gateway call returns `404 WORKSPACE_NOT_FOUND` and zero audit events
are produced. This is a `complete-*` change rather than a `fix-*` because the
runtime implementation does not exist at all — there is no buggy code path
to repair.

## Goals

- Stand up a real `fetchCapabilities` that returns rows in the shape the
  handler at `workspace-capability-catalog.mjs:24-46` already consumes.
- Stand up a real audit emitter that publishes
  `workspace-capability-catalog-accessed-event.json`-shaped messages to Kafka.
- Reconcile the seeded data in migration 090 with whatever table the new
  `fetchCapabilities` actually reads.

## Non-goals

- Replacing the snippet builder or the response contract.
- Migrating the catalog away from `capability_catalog_metadata` to a new
  table; that is a follow-up if needed.
- Building a CMS-style admin surface for managing the catalog content.

## Decisions

### Decision 1: Data sources for `fetchCapabilities`

`fetchCapabilities` MUST join two tables:

- `capability_catalog_metadata` (created by migration 090) for the canonical
  per-capability definition (`capability_key`, `display_name`, `category`,
  `description`, `catalog_version`, `dependencies`).
- A per-workspace enablement table — either `boolean_capability_catalog`
  (already present, referenced by `capability-catalog-list.mjs`) joined by
  `capability_key`, or a new `workspace_capability_enablement(workspace_id,
  capability_key, enabled, status, quota_json)` table created by a new
  migration alongside the work in this change.

The decision between "reuse `boolean_capability_catalog`" and "add a new
per-workspace table" is taken at implementation time based on whether
`boolean_capability_catalog` already carries the per-workspace enablement
columns the handler expects. The spec below mandates the join exists; the
exact source table is an implementation detail.

### Decision 2: Caching

A short-lived (60 s) in-process cache keyed on `(workspaceId, capabilityId)`
is acceptable. The audit event MUST still fire on every call even when the
catalog response is cache-served; otherwise the auditing requirement is
violated.

### Decision 3: Audit emitter wiring

The audit emitter MUST be wired through the existing Kafka producer used by
`provisioning-orchestrator` for plan and provisioning events (whichever module
publishes plan-assigned events today). The default factory MUST accept the
emitter as a constructor argument and the bootstrap path MUST inject the real
emitter. Tests MAY pass a no-op or capture-list emitter.

### Decision 4: Authorisation re-check

The handler already checks `claims.workspaceId` against the path
`workspaceId` at `workspace-capability-catalog.mjs:19-21`. The new
`fetchCapabilities` MUST additionally enforce that the queried workspace
belongs to the claims' tenant, so a cross-tenant lookup with a spoofed
`workspaceId` cannot leak capability metadata even if the path check is
bypassed by a future refactor.

## Risks / Trade-offs

- If migration 090's six seeded rows are kept verbatim, every workspace will
  initially appear to have all six capabilities enabled regardless of plan.
  The new join with per-workspace enablement state mitigates this — but the
  bootstrap must populate enablement rows during workspace creation, which
  may require a downstream change in the workspace-provisioning flow.
- Removing migration 090 entirely is simpler but loses the capability
  metadata that's currently the only source of truth in the repo.

## Migration plan

1. Land the new `fetchCapabilities` factory wiring and a new repository
   module behind a feature flag so existing tests pass unchanged.
2. Backfill per-workspace enablement rows for existing workspaces via a
   data migration step.
3. Flip the gateway-side default factory to the new wiring and remove the
   no-op `emitAuditEvent` default.
4. Add an end-to-end test that calls the wired `main` against an in-memory
   Kafka and asserts both the 200 catalog response and the
   `workspace.capability-catalog.accessed` event.
