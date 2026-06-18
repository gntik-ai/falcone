# fix-functions-ksvc-tenant-namespacing

## Change type
bugfix

## Capability
functions

## Priority
P0

## Why
The Knative Service name `fn-{workspaceName}-{actionName}` omits tenant/workspace id; two tenants with same-named workspaces (`app-staging`) + same action collide on one shared ksvc, so one tenant's deploy overwrites the other's running code.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** A deploys action `x` in its `app-staging`; B deploys action `x` in its `app-staging` (new revision on the SAME ksvc); A invokes its own function → receives B's code output (`OWNED_BY:tenantB`). Root: `function-executor.mjs` ksvc naming + single shared namespace.

GitHub issue #548 (epic #539). Evidence: `audit/live-campaign/evidence/23-events-functions.md`.

## What Changes
Include tenant id + workspace id (or a hash) in the ksvc name and/or a per-tenant namespace; resolve invoke to the caller-scoped ksvc — in the kind `function-executor.mjs` and the product functions runtime.

## Impact
Two same-named workspaces across tenants get distinct ksvcs; cross-tenant invoke isolated; live probe.
