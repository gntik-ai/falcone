## Why

The OpenWhisk function-admin adapter's workspace-secret scope check uses a
truthy-and guard pattern that short-circuits when `context.workspaceId` is
falsy, opening a cross-workspace secret-targeting path. From
`openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B1** (`services/adapters/src/openwhisk-admin.mjs:826`) — the guard reads
  `if (context.workspaceId && payloadWorkspaceId && payloadWorkspaceId !==
  context.workspaceId)`. If `context.workspaceId` is `undefined`, the `&&`
  short-circuits before the `!==` check; the scope-violation push never
  fires. Combined with `:813` deriving `payloadWorkspaceId =
  payload.workspaceId ?? context.targetWorkspaceId`, an upstream that
  forgets to populate `context.workspaceId` (or that allows
  `context.targetWorkspaceId` to come from the request body) lets a caller
  target any workspace's secrets. The same fail-open exists for tenant at
  `:830`.
- **B10** (`openwhisk-admin.mjs:1171-1179`) — the normalised secret-reference
  resource includes per-secret `workspaceId` but no check ensures every
  ref's `workspaceId` matches the caller's workspace. A downstream
  executor that trusts the payload could resolve cross-workspace secrets.
- **G13** (workspace-secret scope check guard fail-open) — no test exercises
  the falsy-context path.

## What Changes

- Invert the guards at `openwhisk-admin.mjs:826` and `:830` to
  `if (payloadWorkspaceId && payloadWorkspaceId !== (context.workspaceId ?? null))`
  so a missing `context.workspaceId` always produces a violation rather
  than skipping the check; mirror the change for tenantId.
- Hoist an explicit `assertWorkspaceScopedContext(context)` invariant at
  the top of the validator so the bug cannot recur if a future refactor
  introduces another truthy guard.
- Validate every secret reference in the normalised resource
  (`openwhisk-admin.mjs:1171-1179`) against the caller's workspace; reject
  the whole request when any reference targets a different workspace.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirement that workspace-secret scope checks fail
  closed when the caller context lacks an explicit workspace, and that
  every secret reference in a normalised resource is bound to the caller's
  workspace.

## Impact

- **Affected code**: `services/adapters/src/openwhisk-admin.mjs:813-840`
  (the validator block including the buggy guards) and `:1171-1179` (the
  secret-reference normalisation), `tests/adapters/openwhisk-admin.test.mjs`.
- **Migration required**: none — compiler change.
- **Breaking changes**: upstreams that today omit `context.workspaceId`
  while sending workspace-secret mutations will start receiving
  `SCOPE_VIOLATION`. This is the intended contract.
- **Out of scope**: the actual function-invocation handler (covered by
  `complete-h1-invocation-handler`); audit-publisher stubs (covered by
  `fix-h1-audit-emitter-stub`).
