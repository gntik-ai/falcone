## 1. Gateway configuration

- [x] 1.1 Establish the platform identity contract from code: `charts/in-falcone/values.yaml::gatewayPolicy.claimsPropagation` + canonical route `proxy-rewrite` (`values.yaml:948-962`) — verified claims are propagated as `X-Tenant-Id`/`X-Workspace-Id`/`X-Auth-Subject`/`X-Actor-Roles` via `$jwt_claim_*`, not as a `params.jwt` object
- [x] 1.2 Edit `deploy/apisix/routes/scheduling.yaml` — add a `proxy-rewrite` plugin injecting the four identity headers from `$jwt_claim_sub`/`$jwt_claim_tenant_id`/`$jwt_claim_workspace_id`/`$jwt_claim_realm_access_roles`
- [x] 1.3 Add a `request-validation` `header_schema` to the same route constraining `X-Auth-Subject`/`X-Tenant-Id`/`X-Workspace-Id`/`X-Actor-Roles` to `maxLength: 0` (reject client-supplied identity headers)
- [x] 1.4 Confirm the required claims exist as Keycloak mappers (`charts/in-falcone/values.yaml:299-359`: `tenant_id`, `workspace_id`, `workspace_roles`) — present; no Keycloak change required

## 2. Action source

- [x] 2.1 Change `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` to derive `tenantId`/`workspaceId`/`actorId`/`roles` from `params.__ow_headers` (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles`); parse roles from the comma-separated header
- [x] 2.2 Return `null` → HTTP 401 `UNAUTHENTICATED` (before any DB op) when `x-tenant-id` or `x-workspace-id` is absent/empty, preserving the #217 fail-closed behavior

## 3. Black-box verification (action-side contract + defense-in-depth)

- [x] 3.1 Update `tests/blackbox/scheduling-identity-token-derivation.test.mjs` to the trusted-header contract: no headers (+ body fields) → 401, no DB query; trusted header overrides conflicting body; missing `x-tenant-id` → 401; missing `x-workspace-id` → 401; `x-tenant-id=A` → query scoped to A
- [x] 3.2 Update `tests/blackbox/scheduling-status-filter-injection.test.mjs` `baseParams` to inject identity via `__ow_headers` (assertions unchanged)
- [x] 3.3 Run `bash tests/blackbox/run.sh` — full suite green (114/114)

## 4. Real-stack verification (gateway-layer scenarios — require APISIX + Keycloak)

- [ ] 4.1 In a real-stack environment, obtain a valid access token for a test tenant; `GET /v1/scheduling/jobs` → HTTP 200 with a scoped list (confirms the gateway injects the identity headers)
- [ ] 4.2 `POST /v1/scheduling/jobs` with a valid token → HTTP 201; verify the row's `tenant_id`/`workspace_id` match the token claims, not any body-supplied values
- [ ] 4.3 `GET /v1/scheduling/jobs` with no token → HTTP 401 at the gateway (action not invoked); with an expired/tampered token → HTTP 401
- [ ] 4.4 Send a request with a client-supplied `X-Tenant-Id` header → rejected (HTTP 400) by `request-validation`
- [ ] 4.5 Two-tenant cross-tenant probe: a token for tenant A cannot retrieve tenant B's jobs

## 5. Optional follow-up (flagged, out of scope)

- [ ] 5.1 (optional) Migrate the scheduling route into the `charts/in-falcone` reconcile loop so it inherits `gatewayPolicy.claimsPropagation` instead of duplicating it
- [ ] 5.2 (optional) Align `webhook-management.mjs` / `workspace-docs.mjs` (`params.auth`) and scheduling (`__ow_headers`) on one identity-injection field
