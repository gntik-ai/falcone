# Shared JWT policy upgrade (#1505)

The executor and control plane now use the same verifier policy. Deploy the source image together with the companion chart configuration. The authentication-wide change requires R3 review and operator approval; this document records prerequisites, not approval or evidence of a completed rollout.

## Behavior changes

- Rejected JWTs on the executor return HTTP 401 with code `INVALID_TOKEN`, including revoked service-account tokens. Missing or invalid non-JWT credentials retain `UNAUTHENTICATED` and `Missing tenant identity`.
- Both workloads enforce the configured platform audiences and tenant audience setting. With tenant enforcement enabled, tenant tokens without `falcone-data-api` are now rejected by the control plane too. Confirm that every existing tenant app and console client has the audience mapper before rollout; provisioning new clients does not prove existing-client coverage.
- Setting the control plane's `KEYCLOAK_ISSUER` to the public issuer also makes service-account credential issuance return a public `tokenEndpoint` instead of an internal endpoint, and social-provider responses return a public broker `callbackUrl` instead of `null`. Assess client reachability and provider callback registration in R3 review. Login continues to use `KEYCLOAK_BASE_URL`.
- Explicitly allowing platform audience `account` alongside `in-falcone` temporarily accepts existing console sessions, and other tokens from that trusted platform realm carrying `account`. This requires explicit R3 human approval. `azp` is never an audience. Remove `account` after mapper reconciliation and session refresh/expiry, no later than 2026-11-14; the source does not enforce that deadline automatically. The removal task is tracked in the [ChangeSet tasks](../../openspec/changes/fix-1505-shared-jwt-trust-policy/tasks.md).

## Companion chart prerequisites

The deployment maker must extend the existing `executor-jwt-env-upgrade` migration and runbook to cover both the control-plane and executor Deployments/containers before publication. Moving existing literal JWT environment entries to ConfigMap `valueFrom` entries can retain both fields and fail an apply. Include the control-plane literal issuer override and duplicate prod-TLS JWKS entries in the paused atomic migration's offline tests and operator release notes. Preserve the ConfigMap guard, rollout checksums, deterministic Helm adapter and External Secrets/OpenBao gates.

Render both workloads from one verifier configuration. Derive the internal trusted realm base from the effective JWKS URL after TLS overrides, including scheme and port. In prod-TLS, assert `https://falcone-keycloak:8443/realms/` and reject the stale `http://falcone-keycloak:8080/realms/` alias unless separately reviewed and explicitly configured. Otherwise tenant JWKS lookups can use plaintext HTTP despite TLS being enabled. Platform aliases must share the configured platform JWKS URL and realm.

Reconcile the console audience mapper on existing platform realms, verify tenant-client mapper coverage, and record the review decisions above before rollout. After normal publication, the operator checks superadmin and tenant-owner flows/MCP lists and cross-tenant denial. Roll back the source image and chart verifier configuration together; the additive audience mapper may remain. The source maker does not perform deployment or live-session checks.
