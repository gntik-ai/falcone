# fix-keycloak-persistent-store

## Change type
bugfix

## Capability
iam

## Priority
P0

## Why
`falcone-keycloak` has no `KC_DB` config and no PVC -> H2 in-memory; any restart wipes all realms (platform + tenant). Memory limit 2Gi.

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Pod `lastState.terminated.exitCode=137` (OOMKilled) ~26min in; `kubectl get pvc` shows no keycloak PVC; no `KC_DB*` env in any profile; after restart `.../realms/in-falcone-platform/.well-known` -> 404 (all realms gone); sub-agents lost JWT auth mid-run.

GitHub epic A. Evidence: `audit/live-campaign/evidence-rerun/11-auth-iam-appauth-keys.md`.

## What Changes
Back Keycloak with the bundled Postgres (or a dedicated PVC for H2-file) so realms persist; raise memory request/limit; ensure every profile (incl. kind) configures persistence.

## Impact
Killing the KC pod preserves the platform + a seeded tenant realm; login works post-restart with no re-bootstrap; KC does not OOM under multi-tenant load.
