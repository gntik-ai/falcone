# add-project-auth-config-api

## Change type
enhancement

## Capability
access-policies

## Priority
P2

## Why
Enabling password/social methods + provider creds is only possible via raw Keycloak admin; there is no Falcone owner-facing API, and the chart `tenantRealmTemplate.requiredClientScopes` aren't applied to tenant realms.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: social IdP enable/disable works via the KC admin API and reflects in login options; no `/v1/...` route exposes it; tenant realms lack the template's required scopes.

GitHub issue #568 (epic #545). Evidence: `audit/live-campaign/evidence/25-auth-enduser.md`.

## What Changes
Add owner APIs to toggle auth methods + configure social providers per project, and apply the template's required scopes at realm provisioning — kind `kc-admin.mjs`/`b-handlers.mjs` + product provisioner.

## Impact
An owner enables username/password + a social provider via the API and the realm's login options reflect it.
