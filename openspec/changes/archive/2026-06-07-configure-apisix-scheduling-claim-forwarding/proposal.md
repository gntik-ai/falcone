## Why

The archived change `derive-scheduling-identity-from-token` (issue #217) made `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` fail-closed, but keyed it on `params.jwt` — a field **no other action in the repository uses and nothing populates**. APISIX cannot construct a JSON `params.jwt` object; the platform's actual, code-evidenced identity contract is **trusted HTTP claim headers**:

- `charts/in-falcone/values.yaml::gatewayPolicy.claimsPropagation` (≈line 2290) defines the contract: `stripIncomingHeaders: true` (anti-spoofing) plus `proxy-rewrite` injection of verified token claims as headers — `X-Tenant-Id` ← `tenant_id`, `X-Workspace-Id` ← `workspace_id`, `X-Auth-Subject` ← `sub`, `X-Actor-Roles` ← `realm_access.roles`.
- The canonical managed routes apply this via `proxy-rewrite.headers` using `$jwt_claim_*` variables (`charts/in-falcone/values.yaml:948-962`; templated in `charts/in-falcone/templates/bootstrap-payload-configmap.yaml:125-145`).
- Every other action reads identity from these headers via `params.__ow_headers` (e.g. `services/openapi-sdk-service/actions/openapi-spec-serve.mjs:29-30` reads `x-tenant-id`; `services/provisioning-orchestrator/...` reads `__ow_headers.authorization`; `services/backup-status/...` reads `__ow_headers`).
- Keycloak issues the claims as snake_case (`charts/in-falcone/values.yaml:303,320,354`: `tenant_id`, `workspace_id`, `workspace_roles`), so the gateway is responsible for the claim→header mapping; the action consumes the resulting headers.

The standalone scheduling route (`deploy/apisix/routes/scheduling.yaml`) is not part of the chart reconcile loop and lacks the claims-propagation `proxy-rewrite` that every managed route has. Consequently, with the #217 guard in place, `params.jwt` is always absent and every scheduling request returns HTTP 401 — the scheduling API is non-functional (issue #241, P1).

This change brings scheduling onto the platform's trusted-header identity contract: the gateway injects verified claims as headers (and rejects client-supplied ones), and `parseIdentity` derives identity from those trusted headers — preserving the #217 fail-closed behavior while removing the `params.jwt` anomaly.

## What Changes

1. `deploy/apisix/routes/scheduling.yaml` — add a `proxy-rewrite` plugin that sets `X-Auth-Subject`/`X-Tenant-Id`/`X-Workspace-Id`/`X-Actor-Roles` from `$jwt_claim_*`, and a `request-validation` `header_schema` that rejects any client-supplied identity headers (`maxLength: 0`), mirroring `gatewayPolicy.claimsPropagation`.
2. `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` — derive `tenantId`/`workspaceId`/`actorId`/`roles` exclusively from `params.__ow_headers` (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles`); return `null` → HTTP 401 `UNAUTHENTICATED` when the trusted tenant/workspace headers are absent. The `params.jwt` read introduced by #217 is replaced.

This **amends the `params.jwt` contract** that change `derive-scheduling-identity-from-token` (#217) established — hence the spec delta MODIFIES the two identity requirements that change added, and ADDS the gateway-side requirements.

### Related (out of scope)

`services/webhook-engine/actions/webhook-management.mjs:39-40` and `services/workspace-docs-service/actions/workspace-docs.mjs:57-63` read identity from `params.auth`. Aligning every action on a single field name (`params.auth` vs `__ow_headers`) is a broader audit, tracked separately.

## Capabilities

### Modified Capabilities

- `scheduling`: identity is now sourced from the gateway's trusted claim headers (not `params.jwt`), and the gateway is required to inject verified claims and reject spoofed ones for the scheduling route.

## Impact

- `deploy/apisix/routes/scheduling.yaml` — MODIFIED (add `proxy-rewrite` claim injection + `request-validation` anti-spoof)
- `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` — MODIFIED (read trusted headers instead of `params.jwt`)
- `tests/blackbox/scheduling-identity-token-derivation.test.mjs` and `tests/blackbox/scheduling-status-filter-injection.test.mjs` — identity injected via `__ow_headers` to match the contract
- Authenticated scheduling requests return HTTP 200/201; unauthenticated requests return 401 (at the gateway, and defense-in-depth at the action)
- Predecessor: issue #217 / `derive-scheduling-identity-from-token` (fail-closed guard); this change: issue #241 (the gateway-side half + correct identity source)
