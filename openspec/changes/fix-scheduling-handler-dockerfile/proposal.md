# fix-scheduling-handler-dockerfile

## Change type
bugfix

## Capability
scheduling

## Priority
P1

## Why
Every `/v1/scheduling/*` -> 500 ERR_MODULE_NOT_FOUND; `services/scheduling-engine/actions/scheduling-management.mjs` is in `route-map.runtime.json` but not COPY'd in `apps/control-plane/Dockerfile`.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: any `/v1/scheduling/*` request crashes 500 before business logic; the .mjs exists in the source tree but not the image.

GitHub epic C. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
Add the COPY for the scheduling handler (and a startup check that every route-map handler resolves).

## Impact
`/v1/scheduling/*` returns business responses; the image build fails if a route-map handler is missing.
