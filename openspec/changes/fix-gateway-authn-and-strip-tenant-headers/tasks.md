## 1. Failing black-box test

- [ ] 1.1 Add a black-box test that sends `POST /v1/workspaces/<A_ws>/api-keys` through the gateway with a spoofed `x-tenant-id` header and **no Authorization**, asserting HTTP 401. Confirm it is RED against the current gateway config.
- [ ] 1.2 Add a black-box test that a client-supplied `x-tenant-id`/`x-workspace-id` header never reaches the backend (the request is rejected or the header is overwritten from the verified token).
- [ ] 1.3 Add a positive black-box test: a request bearing a valid JWT/API key still succeeds (200/201).

## 2. Fix gateway + executor

- [ ] 2.1 Add `openid-connect`/`jwt-auth` and `key-auth` plugins to the public APISIX data-plane routes in the standalone config.
- [ ] 2.2 Add a gateway rule that strips inbound `x-tenant-id`/`x-workspace-id`/`x-auth-subject` from client requests and injects them only from the verified token claims.
- [ ] 2.3 Remove the executor `identityFromHeaders` fallback (or gate it to a mutually-authenticated in-cluster path) so unauthenticated header-only identity is impossible.

## 3. Verify

- [ ] 3.1 Re-run the black-box tests from section 1 — confirm all GREEN.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
