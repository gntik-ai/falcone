Tracking issue: gntik-ai/falcone#641

## Why

`#503` (add-environment-first-class-isolation) and `#502` (per-workspace databases) already made `environment` first-class: a workspace is the delivery boundary for ONE runtime environment, each carrying its own isolated resource set (per-workspace `wsdb_*` database, bucket, topics) and its own stage-scoped service accounts/credentials. The one piece of `#641` still missing is **promotion** — moving an artifact from one environment to another (dev → staging → prod). Today there is no promotion operation: `buildWorkspaceCloneDraft` (`apps/control-plane/src/workspace-management.mjs`) is a pure draft builder with no live route, and `POST /v1/workspaces/{id}/clone` is OpenAPI-only and 404s live. Promoting today means manually re-registering every artifact by hand, which risks silently copying secrets across the dev/prod boundary.

## What Changes

- Add a first-party, tenant-scoped promotion route: `POST /v1/workspaces/{workspaceId}/promotions` (`promoteWorkspace`, authenticated) on the kind control-plane.
- It copies the source workspace's **function registry** (the promotable definition) into a target workspace that lives in a different environment of the SAME tenant. A function whose name already exists in the target is skipped (promotion never overwrites the target), so the operation is safely repeatable.
- It NEVER copies secrets, credentials, service accounts, or database DATA — those are stage-scoped by design (`#502`/`#503`), so a dev secret can never leak into prod. The response makes the exclusion explicit (`notCopied`).
- The source workspace is read-only during promotion (never mutated).
- Tenant isolation (cardinal rule) is enforced on BOTH ends: a missing OR cross-tenant source/target resolves to 404 with no existence leak (mirrors `deleteWorkspace`). A target whose environment does not match the requested target environment is rejected (409); promoting to the source's own environment is rejected (400).
- The action is audited (`workspace.promote`).

## Capabilities

### New Capabilities

### Modified Capabilities

- `tenant-provisioning`: first-class environments gain a promotion operation that moves the promotable definition (functions) across environments without carrying stage-scoped secrets/credentials.

## Impact

- New route + handler on the kind control-plane (`deploy/kind/control-plane/routes.mjs`, `b-handlers.mjs`); audit mapping (`audit-writer.mjs`).
- No schema change (reuses the `workspace_functions` registry and the existing `workspaces`/`environment` model).
- Additive: existing routes/behaviour unchanged.
