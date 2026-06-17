Tracking issue: gntik-ai/falcone#503

## Why

An "environment" (prod/staging/dev) is only a workspace slug today (e.g. workspace "prod" → `wsdb_<tenant>_prod`). There is no environment entity, no per-environment isolated resource set, and no `environment` field on the workspace-create body. Multiple isolated environments per project are not supported.

(Evidence: `tests/live-audit/evidence/11-provisioning-lifecycle.md`.)

## What Changes

- Design note: the domain model already frames a workspace as the "delivery boundary for ONE runtime environment" with a required `environment` field — but it was unimplemented (no column; `workspaceOut` always returned `null`). So "first-class environment" = make that declared field real, with a tenant/project holding multiple workspaces across environments, each isolated by its own per-workspace database (D2/#502).
- Add an `environment` column to `workspaces` (+ carry it on `workspace_databases`), accept + validate it on workspace create against an environment catalog (dev/staging/prod/sandbox/preview; default dev), and return it on the workspace.
- Add `GET /v1/tenants/{t}/environments` listing a tenant's first-class environments, each with its workspaces and provisioned (isolated) databases.

## Capabilities

### New Capabilities

- `tenant-provisioning`: A project supports multiple first-class environments, each with an isolated database, bucket, topics, and secrets.

### Modified Capabilities

## Impact

- Environment entity / model and the workspace (project) create flow.
- Per-environment resource provisioning (DB, bucket, topics, secrets).
