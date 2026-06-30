## Why

Falcone already models `tenant_owner` / `tenant_admin` as administrative tenant roles and
`tenant_developer` / `tenant_viewer` as non-admin roles, but several structural write paths only
checked tenant membership. That allowed a non-admin tenant member to mutate workspace-wide
configuration and infrastructure:

- executor JWT routes for LLM provider config, embedding provider config and embedding mapping, MCP
  server hosting/curation/publish/approval, Events topic creation/publish, and flow definitions;
- kind control-plane storage bucket provisioning/deletion, per-bucket credential rotation/revocation,
  object writes/deletes, presign/multipart operations, and bucket import/export;
- kind control-plane Kafka topic creation and publish;
- the web-console Events page offered create/publish affordances to non-admin roles.

This is a within-tenant privilege escalation. Cross-tenant isolation already holds and must continue
to take precedence where a foreign tenant or unknown object would otherwise leak resource existence.

## What Changes

- Add a structural-write request gate in `apps/control-plane/src/runtime/server.mjs` that applies
  before executor side effects. API-key/dbRole identities are never structural admins, and JWT/header
  identities must carry a positive write-capable admin role. Known non-write roles
  (`tenant_developer`, `tenant_viewer`) and missing/empty-role identities now receive
  `403 FORBIDDEN` for structural writes, while admin roles continue through. Workspace-scoped
  structural writes also enforce verified `workspaceIds` when present and reject unknown workspaces
  with `404 WORKSPACE_NOT_FOUND` before phantom executor writes can occur.
- Carry `workspaceIds` from verified JWT claims and trusted identity headers into executor identities,
  and make the workspace tenant resolver fall back from `workspace_databases` to `workspaces` so
  structural writes for non-database-backed workspaces can still be resolved.
- Add admin-role gates to kind storage and Kafka write handlers after the existing ownership/no-leak
  checks and before S3, SeaweedFS, Kafka, or store side effects. Reads and streams remain unchanged.
- Hide Events console create-topic and publish controls for non-admin roles, while leaving read/poll
  functionality visible.
- Add regression tests for representative executor, storage, Kafka, workspace-scope, unknown-workspace,
  and web-console role-gating scenarios.
- Document the structural-write role-gating rule and add this OpenSpec delta.

## Capabilities

### Modified Capabilities

- `access-control`: structural and administrative writes are authorized by tenant role on every
  executor/control-plane path, not by tenant membership alone; non-admin roles are denied with no
  persistence, and workspace-scoped writes are confined to verified workspace membership.

## Impact

- Backend behavior changes only for structural/admin writes attempted by known non-admin roles or by
  callers outside their verified workspace scope.
- Cross-tenant and missing-resource ordering is preserved: foreign storage buckets still return the
  existing not-found/no-leak outcome before role checks; executor unknown workspace writes now return
  `404 WORKSPACE_NOT_FOUND` instead of creating resources under a phantom workspace.
- No wire-schema, OpenAPI, AsyncAPI, or generated SDK change is required. The existing endpoints and
  response schema remain in place; this is an authorization behavior change using existing `403` and
  `404` outcomes.
