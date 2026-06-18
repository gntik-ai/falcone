# fix-flows-worker-pg-env-and-search-attrs

## Change type
bugfix

## Capability
workflows

## Priority
P1

## Why
The workflow `db.query` activity -> UPSTREAM_UNAVAILABLE because the worker deployment lacks PGHOST/PGUSER/PGPASSWORD/PGDATABASE; and the dev Temporal namespace's custom search attributes are not auto-registered on a fresh install.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: flow create->publish->execute reaches a terminal Temporal state, but `db.query` returns UPSTREAM_UNAVAILABLE; worker env has no PG vars.

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/14-workflows-mcp-realtime.md`.

## What Changes
Inject the PG env into the worker; run a search-attribute bootstrap step on deploy.

## Impact
A flow's `db.query` activity returns rows; flow execution does not 500 on a missing search attribute.
