## Context

This change spans deploy config (APISIX route YAML) and a small action source change, both required to make scheduling identity work on the platform's real contract. Investigation of `charts/in-falcone` showed the platform does **not** inject a `params.jwt` object; verified token claims are propagated to actions as **trusted HTTP headers** via APISIX `proxy-rewrite`, with client-supplied identity headers rejected by `request-validation`. The `params.jwt` field the #217 fix relied on is consumed by no other action and populated by nothing.

## Goals / Non-Goals

**Goals:**

- Configure the scheduling route to inject verified token claims as the platform-standard identity headers (`X-Tenant-Id`, `X-Workspace-Id`, `X-Auth-Subject`, `X-Actor-Roles`) and to reject client-supplied identity headers.
- Have `parseIdentity` derive identity from those trusted headers, preserving the fail-closed (HTTP 401) behavior when they are absent.

**Non-Goals:**

- Folding the scheduling route into the `charts/in-falcone` reconcile loop (it is currently a standalone route file; migrating it is a separate infrastructure effort).
- Aligning the `params.auth` field used by `webhook-management.mjs` / `workspace-docs.mjs` with `__ow_headers` (separate audit).
- Changing Keycloak realm/mapper config: the required claims (`tenant_id`, `workspace_id`, `sub`, `realm_access.roles`) are already mapped (`charts/in-falcone/values.yaml:299-359`).

## Decisions

### Identity transport = trusted headers (not `params.jwt`)

The platform contract (`charts/in-falcone/values.yaml::gatewayPolicy.claimsPropagation`) is:

| logical | token claim | header | action reads (`__ow_headers`) |
|---|---|---|---|
| tenantId | `tenant_id` | `X-Tenant-Id` | `x-tenant-id` |
| workspaceId | `workspace_id` | `X-Workspace-Id` | `x-workspace-id` |
| subject | `sub` | `X-Auth-Subject` | `x-auth-subject` |
| roles | `realm_access.roles` | `X-Actor-Roles` | `x-actor-roles` |

OpenWhisk lowercases header keys, so the action reads the lowercase forms. `X-Actor-Roles` is a comma-separated string, parsed into an array (same approach as `workspace-docs.mjs::parseRoles`).

### Gateway config (`deploy/apisix/routes/scheduling.yaml`)

- `proxy-rewrite.headers` sets the four identity headers from `$jwt_claim_sub` / `$jwt_claim_tenant_id` / `$jwt_claim_workspace_id` / `$jwt_claim_realm_access_roles`, mirroring the canonical route (`charts/in-falcone/values.yaml:948-962`).
- `request-validation.header_schema` declares the four identity headers with `maxLength: 0`, so a request that supplies any of them is rejected — the gateway is the sole source of identity (anti-spoofing, equivalent to `stripIncomingHeaders: true`).
- `openid-connect: bearer_only: true` is retained: it validates the token; `$jwt_claim_*` are only available after that validation.

### Action contract (`parseIdentity`)

Reads `x-tenant-id` / `x-workspace-id` / `x-auth-subject` / `x-actor-roles` from `params.__ow_headers`; returns `null` (→ HTTP 401 `UNAUTHENTICATED`, before any DB op) when `x-tenant-id` or `x-workspace-id` is absent/empty. Caller-supplied body/query fields are never consulted.

## Risks / Trade-offs

- **Two transports until the broader audit lands**: scheduling now uses `__ow_headers` while webhooks/workspace-docs use `params.auth`. Accepted; aligning them is tracked separately.
- **Gateway-layer behavior is not unit-testable**: the 401-at-the-gateway and header-stripping scenarios require a real APISIX + Keycloak stack (real-stack E2E). Black-box tests cover the action-side contract and defense-in-depth; the gateway scenarios are verified via E2E.
- **Standalone route drift**: `deploy/apisix/routes/scheduling.yaml` is maintained separately from the chart's managed routes; the claims-propagation config is duplicated here rather than inherited. Migrating scheduling into the reconcile loop would remove the duplication (out of scope).
