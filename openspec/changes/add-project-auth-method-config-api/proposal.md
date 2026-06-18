# add-project-auth-method-config-api

## Change type
enhancement

## Capability
access-control

## Priority
P2

## Why
The per-tenant realm + `{slug}-app` client + auth-method templates exist, but enabling username/email vs social IdPs is only doable via raw Keycloak admin — no Falcone API.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/...` route exposes it.

GitHub epic D. Evidence: `audit/live-campaign/evidence-rerun/11-auth-iam-appauth-keys.md`.

## What Changes
A project-scoped API to toggle auth methods + configure social providers (credentials redacted).

## Impact
An owner enables/disables a method via the API and the app's login options reflect it.
