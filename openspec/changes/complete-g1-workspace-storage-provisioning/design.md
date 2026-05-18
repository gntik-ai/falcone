## Context

`services/adapters/src/storage-tenant-context.mjs:465-469` exports
`provisionWorkspaceStorageBoundary()` as an unconditional throw. The audit
flagged this as B6. The function exists as a guarded stub per the
helper-comment at `:463`, but several upstream workflows (notably the
workspace-create saga from C1) treat this as a production dependency. As a
result, those workflows silently break or fall through to a stubbed boundary
that's effectively no-op.

This is a `complete-*` change because there is no buggy code path to repair —
the implementation does not exist at all.

## Goals

- Stand up a real `provisionWorkspaceStorageBoundary(context, request)` that
  returns a workspace-storage boundary record and an audit envelope.
- Define the contract with `services/provisioning-orchestrator` so the
  orchestrator owns persistence and publishing while the adapter owns the
  compiled plan.
- Cooperate with `fix-g1-audit-emission-wiring`'s fail-closed audit publisher
  contract.

## Non-goals

- Provider-side bucket creation (the executor in the orchestrator calls the
  S3-compatible provider; this proposal stops at the compiled plan).
- Cross-region replication boundaries.
- Re-architecting the namespace deriver (already at
  `storage-tenant-context.mjs:117-126`).

## Decisions

### Decision 1: Where the helper lives

The helper stays in
`services/adapters/src/storage-tenant-context.mjs` alongside
`deriveTenantStorageNamespace`. The adapter is a pure compiler; the helper
returns a plan record plus an audit envelope. The orchestrator persists.

### Decision 2: Contract with provisioning-orchestrator

The orchestrator calls
`provisionWorkspaceStorageBoundary(context, request)` inside the workspace-
create saga at the same step that today catches `NOT_YET_IMPLEMENTED`. The
returned record is persisted into the `workspace_storage_boundary` table
(owned by C1) and the audit envelope is published via the same
`context.publishAuditEvent` that `fix-g1-audit-emission-wiring` requires.

### Decision 3: Feature flag for disablement

A `STORAGE_BOUNDARY_PROVISIONING_DISABLED=true` environment flag is honoured
so a deployment can opt out (e.g. for a managed-storage tenant that
provisions out-of-band). When set, the helper returns
`{ status: 'NOT_YET_IMPLEMENTED', reason: 'feature_flag_disabled' }`. The
unconditional throw is replaced — the feature flag is the only escape hatch.

### Decision 4: Audit-emission cooperation

The helper builds an audit envelope but does NOT publish it itself. That keeps
the compiler pure and lets `fix-g1-audit-emission-wiring`'s façade wrapper own
the publish path. Tests assert the helper throws
`WORKSPACE_STORAGE_PUBLISHER_MISSING` when invoked without
`context.publishAuditEvent` so the fail-closed contract is preserved at the
boundary.

## Risks / Trade-offs

- The orchestrator-side persistence layer (C1) must be ready before this
  helper is wired into the saga. If C1's persistence isn't ready, the
  helper still validates the plan but the saga step is skipped — track
  the dependency explicitly in the implementation PR.
- A deployment with the feature flag set will create workspaces without
  storage boundaries; existing object-storage operations on those
  workspaces will fail. Document this in the operator runbook.

## Migration plan

1. Land the helper implementation behind the feature flag (default off, so
   existing throw behaviour is unchanged at first deployment).
2. Add the orchestrator-side wiring in the workspace-create saga.
3. Flip the feature flag in CI; backfill existing workspaces with a one-time
   data migration that calls the helper for each existing workspace.
4. Remove the feature flag's default-off behaviour once backfill is verified.
