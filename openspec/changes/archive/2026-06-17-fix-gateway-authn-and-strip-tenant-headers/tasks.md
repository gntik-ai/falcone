## 1. Failing black-box test

- [x] 1.1 Add a black-box test that sends `POST /v1/workspaces/<A_ws>/api-keys` through the executor with a spoofed `x-tenant-id` header and **no Authorization**, asserting HTTP 401. Confirmed RED against the current code (was: 201, key minted).
- [x] 1.2 Add black-box tests that header-only requests (x-tenant-id/x-workspace-id, no credential, no trust signal) are rejected with 401 across data-plane routes (api-keys, postgres). Confirmed RED (was: 201 / 503).
- [x] 1.3 Add positive black-box tests: a request with valid API key still succeeds (not 401/403); a header request WITH the gateway trust signal still works (not 401). Both were already GREEN before the fix (confirmed).

## 2. Fix gateway + executor

- [x] 2.1 APISIX standalone config (`deploy/kind/apisix/apisix.yaml`): added `proxy-rewrite` plugin to all executor-bound routes (2003-keys, 2005-key through 2008-key, 2016-rt) that strips inbound `x-tenant-id`/`x-workspace-id`/`x-auth-subject`/`x-actor-roles` headers and injects `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}` so the executor can verify the request came from the authenticated gateway.
- [ ] 2.1-DEFERRED: Full OIDC/JWT auth plugin wiring (`openid-connect` + `key-auth`) on the public APISIX data-plane routes — left as follow-up because (a) the executor's JWT verifier (KEYCLOAK_JWKS_URL) already handles JWT validation on executor-bound routes, (b) the API-key routes are verified by the executor directly, and (c) adding `openid-connect` to key-routes that use `vars: [http_apikey ~~]` requires careful ordering to avoid rejecting valid API-key requests. The header-strip + x-gateway-auth injection closes the primary exploit in combination with task 2.3 below.
- [x] 2.2 Gateway rule strips inbound `x-tenant-id`/`x-workspace-id`/`x-auth-subject`/`x-actor-roles` from client requests on all executor-bound routes (proxy-rewrite headers set to "") and injects `x-gateway-auth` from the operator-configured secret. See `deploy/kind/apisix/apisix.yaml`.
- [x] 2.3 Executor `identityFromHeaders` fallback gated behind gateway trust signal (`gatewaySharedSecret` option on `createControlPlaneServer`; `GATEWAY_SHARED_SECRET` env var in `main.mjs`). When the secret is configured and the incoming `x-gateway-auth` header is absent or wrong → `{ tenantId: undefined }` → 401. When no secret is configured (dev/test mode) → legacy behaviour preserved (fail-open at the executor; dev responsibility). All 6 new black-box tests GREEN. Existing env/executor and blackbox tests GREEN (they instantiate the server without `gatewaySharedSecret` → dev mode).

## 3. Verify

- [x] 3.1 All 6 new black-box tests GREEN (confirmed RED→GREEN diff above).
- [x] 3.2 `bash tests/blackbox/run.sh` — 630/630 pass, 0 fail (full suite including all pre-existing tests).
- [x] 3.3 `tests/env/executor/control-plane-http.test.mjs` — 11/11 pass (header-identity path works in dev mode without `gatewaySharedSecret`).
- [x] 3.4 `helm template test charts/in-falcone --skip-schema-validation` renders 75 objects, 0 Helm errors.
- [x] 3.5 `deploy/kind/apisix/apisix.yaml` passes Python YAML syntax validation.
