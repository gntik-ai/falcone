## Context

`services/adapters/src/mongodb-data-api.mjs` is the authoritative chokepoint for all
document-store isolation: every read, write, update, replace, and delete passes through
`applyTenantScopeToFilter` (filter injection) and `injectTenantIntoDocument` (stamp).
Today those helpers inject `tenantId` only. `buildMongoDataApiPlan` already receives
`workspaceId` as a required parameter (passed by the executor at
`apps/control-plane/src/runtime/mongo-data-executor.mjs`) but never threads it into
the scope helpers. The credential→workspace binding at
`apps/control-plane/src/runtime/server.mjs:846-851` ensures the `workspaceId` on the
plan is verified and authoritative before it reaches the adapter.

## Goals / Non-Goals

**Goals:**
- Extend `applyTenantScopeToFilter` and `injectTenantIntoDocument` to accept and apply
  an optional `workspaceId` argument, so both the query predicate and the persisted
  stamp carry `tenantId` AND `workspaceId`.
- Propagate `workspaceId` from `buildMongoDataApiPlan` into both helpers at every call
  site: `buildTenantMatchFilter`, `buildChangeStreamTenantMatch`, and the
  bulk/transaction/export re-scope paths.
- Reject any insert/replace/update whose document payload carries a `workspaceId`
  differing from the caller's bound workspace with HTTP 403
  (`mongo_data_tenant_scope_violation`), matching the existing forged-`tenantId` guard.

**Non-Goals:**
- Changing the executor, route table, or `/v1/collections/*` API shapes — the executor
  already passes `workspaceId` and the route contract is unchanged.
- The realtime/CDC pgoutput pipeline (#460) — it is a distinct surface (Postgres logical
  replication, not the MongoDB wire-protocol adapter) and is out of scope.
- The kind console browse handler at `deploy/kind/control-plane/mongo-handlers.mjs` —
  it is an internal dev-mode surface, not a tenant-facing route, and is out of scope.

## Decisions

**Decision: Generalize the existing chokepoint rather than adding a parallel filter at each call site.**
Rationale: The single `applyTenantScopeToFilter`/`injectTenantIntoDocument` chokepoint
is the reason tenant isolation is currently sound. Adding a parallel `workspaceId` filter
at every individual call site (list, get, insert, update, delete, bulk, aggregate, export)
would require N changes and would be leak-prone — any call site missed or added later
without the extra predicate would silently open a gap. Generalizing the shared helper to
carry both predicates means every existing and future call site is protected by
construction with zero incremental risk per call site.

**Decision: Fail-closed for legacy unstamped documents (no backfill).**
Rationale: Documents written before this fix carry no `workspaceId` field. After the fix,
workspace-scoped reads will not return them because the injected predicate requires
`workspaceId` to match. Backfill is impossible by construction: `workspaceId` was never
recorded, so there is no basis on which to attribute a legacy document to any specific
workspace. Fail-closed (legacy docs become unreadable via the workspace-scoped route) is
the only correct resolution — it is consistent with the per-workspace SQL (`wsdb_*`) and
storage (per-workspace bucket) planes, both of which have always been workspace-scoped,
and it eliminates the cross-workspace leak rather than silently tolerating it. Operators
who need legacy docs must migrate them manually out-of-band.

**Decision: Trust the path workspaceId as authoritative.**
Rationale: The credential→workspace binding at `apps/control-plane/src/runtime/server.mjs:846-851`
already enforces that the path workspace must equal the API key's bound
`credentialWorkspaceId` before the request reaches the executor. The `workspaceId`
arriving at `buildMongoDataApiPlan` has therefore already been verified — the adapter can
treat it as authoritative without a redundant re-check.

**Decision: Out-of-scope surfaces stay out of scope.**
The realtime/CDC pgoutput pipeline (#460) uses Postgres logical replication (pgoutput),
not the MongoDB wire-protocol adapter; its change-event scoping is a separate concern
tracked under a dedicated change. The kind console browse handler
(`deploy/kind/control-plane/mongo-handlers.mjs`) is a dev-mode-only surface that does
not serve tenant-facing traffic and is explicitly out of scope for this fix.

## Risks / Trade-offs

**Risk:** Legacy documents become unreadable via workspace-scoped routes after the fix.
**Mitigation:** This is the intended fail-closed behavior. Operators are responsible for
migrating or acknowledging legacy unstamped documents. The fix includes a note in
proposal.md and this design.md documenting the back-compat decision explicitly.

**Risk:** Callers of `applyTenantScopeToFilter` that do not pass `workspaceId` (e.g.
non-executor internal paths) receive a tenant-only scope.
**Mitigation:** The `workspaceId` argument is optional; when absent the helper behaves
exactly as today (tenant-only predicate). Backward compatibility is preserved.

## Migration Plan

No schema changes and no route contract changes. Changes are localized to:

1. `services/adapters/src/mongodb-data-api.mjs`: extend `applyTenantScopeToFilter` and
   `injectTenantIntoDocument` to accept and apply `workspaceId`; propagate it through
   `buildTenantMatchFilter`, `buildChangeStreamTenantMatch`, and all re-scope paths;
   add the forged-`workspaceId` guard (HTTP 403) parallel to the existing forged-`tenantId`
   guard; feed `workspaceId` from `buildMongoDataApiPlan` into `applyTenantScopeToFilter`.
2. Black-box tests in `tests/blackbox/mongo-workspace-document-isolation.test.mjs`
   (reproduce first, then verify green after the fix).
