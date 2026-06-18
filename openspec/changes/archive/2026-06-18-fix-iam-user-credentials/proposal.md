# fix-iam-user-credentials

## Change type
bugfix

## Capability
iam

## Priority
P1

## Why
`POST /v1/iam/realms/{realm}/users` with `credentials:[{type:password,...}]` creates the user but no password is set -> the end-user cannot log in.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: register -> 201, but `GET .../users/{id}/credentials` -> [] (credentialTypes empty) -> ROPC login `invalid_grant`. After a KC-admin password set, login -> 200 with an un-forgeable tenant_id claim.

GitHub epic D. Evidence: `audit/live-campaign/evidence-rerun/11-auth-iam-appauth-keys.md`.

## What Changes
Pass the credentials through to Keycloak on create (or expose a set-password sub-route).

## Impact
A user created with a password can immediately log in.
