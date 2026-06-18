# add-gateway-realtime-config-identity

## Change type
bugfix

## Capability
gateway

## Priority
P1

## Why
The CDC capture handler (`/v1/realtime/workspaces/{ws}/pg-captures`) and the tenant config-mgmt routes (`/v1/admin/config/*`) require BOTH a verified JWT AND gateway-injected identity headers. APISIX routes these paths but does not run the identity-injection plugin for them -> every call 401 ('missing identity headers'); the executor/CP direct path -> 401 ('missing Bearer token'). The handlers are deployed and unreachable. (Initially mis-reported as not-deployed.)

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: superadmin JWT -> `GET /v1/realtime/workspaces/{ws}/pg-captures` -> 401 'missing identity headers'; trust-header direct -> 401 'Missing or invalid Bearer token'; the realtime change-stream (a different, wired route) works.

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

## What Changes
Wire the APISIX identity-injection plugin for `/v1/realtime/*` (captures) and `/v1/admin/config/*`, mirroring the working data-plane routes (relates to the flows/mcp gateway-route gap G3).

## Impact
`GET /v1/realtime/workspaces/{ws}/pg-captures` and `/v1/admin/config/*` return business responses for an authorized caller; cross-tenant denied.

Dependencies: Relates to G3.
