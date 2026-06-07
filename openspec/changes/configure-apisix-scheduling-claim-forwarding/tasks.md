## 1. Gateway configuration

- [ ] 1.1 Confirm the APISIX version pinned in `deploy/apisix/` manifests and identify the correct `openid-connect` plugin option for claim-forwarding (e.g., `set_access_token_header`, `access_token_in_authorization_header`, or `set_userinfo_header`) in that version's plugin documentation
- [ ] 1.2 Edit `deploy/apisix/routes/scheduling.yaml` — add the verified claim-forwarding directive to the `openid-connect` plugin block (currently lines 11-14) so that the decoded bearer token claims are injected into the upstream action invocation as `params.jwt`
- [ ] 1.3 Confirm that the claims `tenantId`, `workspaceId`, `sub`, and `roles` are present in the Keycloak-issued access token for the scheduling client; if any are absent, raise a follow-up to configure the corresponding Keycloak token mapper (that work is out of scope for this change)

## 2. Verification — authenticated flow

- [ ] 2.1 In a real-stack environment (APISIX + Keycloak + scheduling-engine), obtain a valid access token for a test tenant; issue `GET /v1/scheduling/jobs` and assert HTTP 200 with a scoped job list — confirming that `params.jwt` is now populated and `parseIdentity` succeeds
- [ ] 2.2 Issue `POST /v1/scheduling/jobs` with the valid token and a valid cron-job body; assert HTTP 201 and verify in the database that the created row has `tenant_id` and `workspace_id` matching the token claims (not any body-supplied values)

## 3. Verification — unauthenticated and invalid-token flow

- [ ] 3.1 Issue `GET /v1/scheduling/jobs` without an `Authorization` header; assert HTTP 401 returned by the gateway (no action invocation)
- [ ] 3.2 Issue a request with a malformed or expired bearer token; assert HTTP 401 from the gateway

## 4. Integration or E2E check

- [ ] 4.1 Add or extend an E2E / integration test (under `tests/e2e/specs/issues/` or `tests/blackbox/`) that drives the full authenticated scheduling request end-to-end through a real APISIX + Keycloak stack: valid token → HTTP 200/201; no token → HTTP 401; expired token → HTTP 401
- [ ] 4.2 Ensure the test provisions two tenants (A and B) and includes a cross-tenant probe: a token for tenant A cannot retrieve tenant B's jobs (gateway rejects or action scopes correctly)

## 5. Optional follow-up (flagged, out of scope)

- [ ] 5.1 (optional) Audit `deploy/apisix/routes/webhooks.yaml` for the same claim-forwarding gap — `keycloak-openid: bearer_only: true` (lines 7-9) has no claim-forwarding either, and `webhook-management.mjs` reads identity from `params.auth` rather than `params.jwt`; determine whether the gateway-to-action identity-injection contract is consistent and correct for that route
