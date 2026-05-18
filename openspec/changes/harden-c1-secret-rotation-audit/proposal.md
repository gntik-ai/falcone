## Why

Four likely bugs and one major gap in the secret-rotation, privilege-domain, and scope-enforcement audit pipelines of `services/provisioning-orchestrator/` undermine the audit guarantees the rest of the platform relies on. From `openspec/audit/cap-c1-plan-tenant-provisioning.md`:

- **B5.6** (`privilege-domain-assign.mjs:43-50`) — last-admin guard race. `FOR UPDATE` covers the count read but the upsert at `:50` is not inside the same FOR UPDATE scope; two concurrent revokes can both pass the guard and both UPDATE, leaving a workspace with zero structural admins.
- **B5.7** (`credential-rotation-repo.mjs:22-23`) — expiry-sweep is not idempotent. A re-run after partial success can double-revoke credentials and double-emit `console.credential-rotation.deprecated-expired`.
- **B5.8** (`function-privilege-denial-recorder.mjs:25`) — validator accepts `null` `workspaceId`. Workspace-scoped denials are silently un-scoped, breaking the per-workspace audit slice.
- **B5.9** (`scope-enforcement-repo.mjs:56, :10`) — cursor pagination tuple `(denied_at, id)` collides for events sharing the same `denied_at`; a decode that returns null `id` causes the next page to skip rows.
- **G30** — `secret_propagation_events` has a `failed` state with no code path that sets it (pending->confirmed->timeout only); the schema enum is dead weight today.

## What Changes

- Move the `privilege-domain-assign` upsert inside the same FOR UPDATE scope as the count read, or use a single SQL statement that performs the guard check and the upsert atomically.
- Rewrite `credential-rotation-repo.expirySweep` to `UPDATE … WHERE state='deprecated' AND expires_at < NOW() RETURNING …`, then publish events for the returned rows only (no second-write idempotency required).
- Require `workspaceId` non-null in `function-privilege-denial-recorder.validate` for any denial whose `requiredSubdomain` is workspace-scoped.
- Change scope-enforcement cursor to a strict `(denied_at, id)` tuple comparison `WHERE (denied_at, id) > ($1, $2)` and reject decodes with null fields.
- Either wire a path that sets `secret_propagation_events.state='failed'` (e.g., consumer reports apply error) or remove the enum value via migration. This proposal wires the path.

## Capabilities

### Modified Capabilities

- `secret-management`: tightens last-admin guard atomicity, expiry-sweep idempotency, denial recorder validation, scope-enforcement cursor pagination, and propagation-event lifecycle.

## Impact

- Affected code: `services/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs`, `services/provisioning-orchestrator/src/repositories/credential-rotation-repo.mjs`, `services/provisioning-orchestrator/src/actions/function-privilege-denial-recorder.mjs`, `services/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs`, `services/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs` (or the appropriate report-failure path).
- Migrations: no schema change (existing enums are reused).
- Breaking changes: callers that previously emitted `function_privilege_denials` with null `workspaceId` for workspace-scoped denials will get 400.
- Out of scope: vault/DB split-brain (B5.1-B5.5 — `fix-c1-secret-rotation-split-brain`).
