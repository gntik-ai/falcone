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
- [x] 2.2a Wire the PostgreSQL suite into the existing PR executor real-stack runner.
- [x] 2.3 Write console network-boundary tests and update the Members wizard test.
- [ ] 2.4 PR CI: run the full unit suite, Vitest, TypeScript and Swagger/OpenAPI validation.
- [ ] 2.5 PR CI: run the isolated PostgreSQL integration tests with DATABASE_URL, DB_URL or PGHOST (executor runner supplies PGHOST).
- [x] 2.6 Run strict OpenSpec validation.
- [ ] 2.7 PR CI/release gate: run image/security gates.

## 3. Deployment Maker / Release Gate

- [x] 3.1 Initial deployment maker wired invitation HMAC key/key id env refs via OpenBao/ExternalSecrets and schema (4d6dcac82aeecbe8502d2a08be3a6ea5a7850726).
- [x] 3.2 Initial deployment maker added missing-reference failure and successful-render Helm tests; checker confirmed both pass.
- [ ] 3.3 Verify unauthenticated token acceptance and authenticated linking reach the handler
  through the gateway; preserve all other tenant authentication gates.
- [ ] 3.4 Stage-revalidate reads, proof consumption, invited role and invitation-only signup.
- [ ] 3.5 Deployment maker: remove the required-startup-reference/post-hook Secret deadlock and add a regression chart test for Helm --wait safety.
- [ ] 3.6 Release gate: verify a final schema scrub after previous-image invitation writers stop.

## 4. Source Checker Follow-up

- [x] 4.1 Reproduce the overly broad legacy UPDATE in a real SQL engine; expire pending rows only and preserve accepted/revoked states.
- [x] 4.2 Document previous-image writes during rolling updates and the durable audit-stream interpretation of iam.invitation.*.
- [x] 4.3 Reproduce identity-provider concurrency rejection; move membership reads to their own module and bound role reads to eight.
- [x] 4.4 Expand dense proof validation and name token/email helpers explicitly.
- [x] 4.5 Clarify the unit database fake's limits; require the existing PostgreSQL tests in PR real-stack CI for actual atomicity evidence.
