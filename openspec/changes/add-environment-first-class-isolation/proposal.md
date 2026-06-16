Tracking issue: gntik-ai/falcone#503

## Why

An "environment" (prod/staging/dev) is only a workspace slug today (e.g. workspace "prod" → `wsdb_<tenant>_prod`). There is no environment entity, no per-environment isolated resource set, and no `environment` field on the workspace-create body. Multiple isolated environments per project are not supported.

(Evidence: `tests/live-audit/evidence/11-provisioning-lifecycle.md`.)

## What Changes

- Introduce a first-class environment concept so a project can hold multiple environments (prod/staging/dev), each with its own isolated resource set (database, bucket, topics, secrets).

## Capabilities

### New Capabilities

- `tenant-provisioning`: A project supports multiple first-class environments, each with an isolated database, bucket, topics, and secrets.

### Modified Capabilities

## Impact

- Environment entity / model and the workspace (project) create flow.
- Per-environment resource provisioning (DB, bucket, topics, secrets).
