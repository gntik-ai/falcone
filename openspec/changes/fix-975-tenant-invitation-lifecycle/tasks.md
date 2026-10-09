## 1. Reproduction and Source

- [x] 1.1 Reproduce absent GET collection route with a failing route-table test.
- [x] 1.2 Add lifecycle HTTP routes and seed/runtime/catalog mappings.
- [x] 1.3 Replace unkeyed hashes and masked email with HMAC, key id and token hash.
- [x] 1.4 Add scoped reads, expiry projection, conditional claim, revoke and resend persistence.
- [x] 1.5 Grant role/binding after claim; compensate Keycloak failures and require resend.
- [x] 1.6 Share acceptance with invitation signup; leave public signup unverified; audit callers.
- [x] 1.7 Return tenant-user roles and persist safe iam.invitation.* audit events transactionally.
- [x] 1.8 Add Members invitation management, one-time link display and public acceptance page.
- [x] 1.9 Update unified OpenAPI, IAM/tenant/auth family artifacts and route discovery.

## 2. Bounded Verification

- [x] 2.1 Run dependency-free handler, token/privacy, scope, negative-path and concurrency tests.
- [x] 2.2 Write isolated PostgreSQL migration/idempotency/concurrency tests.
- [x] 2.3 Write console network-boundary tests and update the Members wizard test.
- [ ] 2.4 PR CI: run the full unit suite, Vitest, TypeScript and Swagger/OpenAPI validation.
- [ ] 2.5 PR CI: run the isolated PostgreSQL integration tests with DATABASE_URL.
- [x] 2.6 Run strict OpenSpec validation.
- [ ] 2.7 PR CI/release gate: run image/security gates.

## 3. Deployment Maker / Release Gate

- [ ] 3.1 Wire required invitation HMAC key/key id env refs via OpenBao/ExternalSecrets and schema.
- [ ] 3.2 Verify Helm fails without the ExternalSecret reference and renders required refs with it.
- [ ] 3.3 Verify unauthenticated token acceptance and authenticated linking reach the handler
  through the gateway; preserve all other tenant authentication gates.
- [ ] 3.4 Stage-revalidate reads, proof consumption, invited role and invitation-only signup.
