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

## Status (SUPERSEDED — corrected scope, 2026-06-19)
This change is **already implemented** by the archived `add-project-auth-config-api` (#568, epic
#545). Verified against current code:

- Routes (`deploy/kind/control-plane/routes.mjs:58-61`): `GET`/`PUT /v1/tenants/{tenantId}/auth-config`,
  `PUT`/`DELETE /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}` — own-tenant
  authorized, cross-tenant → 403.
- Handlers (`deploy/kind/control-plane/b-handlers.mjs:853-921`): `getAuthConfig` / `setAuthConfig` /
  `setSocialProvider` / `deleteSocialProvider`, audited via `audit-writer.mjs`.
- Keycloak admin client (`kc-admin.mjs`): `getRealmAuthConfig` / `setRealmAuthConfig` /
  `listIdentityProviders` / `upsertIdentityProvider` (read-merge-PUT, credentials redacted on read).
- Black-box coverage already exists: `tests/blackbox/project-auth-config-api.test.mjs` (8/8 passing).

The re-run dry-run regenerated an already-resolved finding (filed under epic D / #599 instead of the
existing #568). **Decision:** close GitHub issue #599 as superseded by #568. No code change.

## Impact
An owner enables/disables a method via the API and the app's login options reflect it (already true via #568).
