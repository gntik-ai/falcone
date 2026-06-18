# fix-flows-worker-db-activity-wiring

## Change type
bugfix

## Capability
workflows

## Priority
P1

## Why
A flow executes to a terminal Temporal state, but the `db.query` activity throws `postgres executor not wired into db.query activity` → no data operation occurs.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: create→publish→`POST .../executions` → execution `Failed`; worker log: ApplicationFailure 'postgres executor not wired'; target row not inserted.

GitHub issue #563 (epic #543). Evidence: `audit/live-campaign/evidence/24-flows-mcp-realtime.md`.

## What Changes
Inject/configure the postgres (and mongo/storage/event) executor into the workflow-worker activities (DSN + tenant RLS context) via the chart `workflowWorker.config`.

## Impact
A `db.query` flow inserts/reads a tenant-scoped row and the execution completes successfully.
