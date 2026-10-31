# Implementation and validation

## Source implementation

- [x] Verify the clean assigned worktree, issue branch and immutable base `b694e45e487b1c49238e30a544fb7076fc18a7d6`.
- [x] Read the supplied implement-issue execution contract and bounded verifier, server, revocation and packaging context.
- [x] Establish red-capable reproduction before modifying source: internal-issuer/account token passes the deployed control-plane policy and fails the executor issuer check. Record hypotheses, command and cause in proposal/design.
- [x] Share exact issuer-base allowlisting, platform audience membership, tenant enforcement, cryptographic checks, failure categories and environment parsing.
- [x] Preserve both verifier APIs, actor mapping, single-issuer/bare-JWKS compatibility, startup verification gate, credential precedence and workspace authorization gates.
- [x] Pass verified realm context to both tenant-scoped service-account revocation hooks; active and revoked tokens are tested across aliases.
- [x] Add distinct `INVALID_TOKEN` handling with red/green HTTP regression tests for both flows and MCP.
- [x] Add token-free, bounded failure diagnostics and red/green category/log tests, including hostile audience values.
- [x] Test configuration failures before fixes: wildcard bases without a primary issuer and mismatched explicit platform realm.
- [x] Reproduce HTTP 401 at the immutable base using the same generated token fixture.
- [x] Record explicit temporary `account` audience decision and companion chart environment contract in design.md.

## Bounded checks

The previous implementation ran verifier, identity, workspace-binding, tenant-audience, revocation and realtime API-key/SSE regression suites with Node's test isolation disabled. No timeout wrapper was used. That bounded corpus passed 778 tests, but omitted `workspace-sa-rollback-auth.test.mjs`; it did not establish that the entire unit suite passed. The follow-up validation below supersedes that evidence for the current source tree.

The bounded set is:

- `tests/unit/jwt-trust-policy-parity.test.mjs`
- `tests/unit/executor-console-jwt-routes.test.mjs`
- `tests/unit/control-plane-jwt-verify.test.mjs`
- `tests/unit/executor-platform-caller-identity.test.mjs`
- `tests/unit/sa-revocation-check.test.mjs`
- `tests/unit/executor-identity-guard.test.mjs`
- `tests/unit/executor-workspace-binding.test.mjs`
- `tests/unit/executor-mcp-workspace-binding.test.mjs`
- `tests/unit/executor-service-account-binding.test.mjs`
- `tests/unit/tenant-data-api-audience.test.mjs`
- `tests/unit/realtime-change-stream-contract.test.mjs`
- `tests/blackbox/tenant-realm-token-issuance.test.mjs`
- `tests/blackbox/kind-control-plane-multirealm-jwt.test.mjs`
- `tests/blackbox/sa-credential-revocation-invalidate-tokens.test.mjs`
- `tests/blackbox/executor-platform-caller-identity.test.mjs`

Also run syntax checks for changed JavaScript modules, Markdown lint and `git diff --check`. Existing API-key, gateway and SSE test cases remain unchanged; the four existing invalid-JWT response assertions in the platform-caller blackbox suite now expect the specified new error code.

## Environment limits and handoff

- The previous maker reported that Node's default test subprocess mode could not execute. The follow-up maker successfully ran the bounded set in default mode; no isolation flag is required for that evidence.
- `tests/unit/control-plane-jwt-identity.test.mjs` cannot initialize its TCP listener: `listen EPERM: operation not permitted 127.0.0.1`. Report SKIPPED, not an assertion failure. The generated-token in-memory HTTP tests cover both affected routes without binding a socket. PR CI must run socket-based identity suites.
- Image builds and deployment chart render/provisioning tests are not run by this source maker. They require the separate deployment repository/CI and Docker infrastructure.
- The deployment maker must consume the exact new env contract, reconcile the console mapper on existing realms, preserve ConfigMap/valueFrom/migration/checksum safeguards and add render parity tests. Tenant audience enforcement requires the corresponding mapper on tenant console/app clients.
- The operator must confirm live superadmin and tenant-owner flows/MCP behavior after normal delivery and remove the explicit rollout audience by the documented deadline. Independent review must assess the issue's R3 concern and the account-audience compatibility decision against supplied R1 policy.
- No dependencies, lockfiles, workflow pins, credentials, deployment state or unrelated source files change. Commit locally; do not push, merge or deploy.

## Checker follow-up (2026-10-31)

- [x] Confirm assigned branch, clean worktree and prior HEAD `5d803feafa87e1bb4aeefeedc3cbcdafa0636174`; preserve existing commits and workflow pins.
- [x] Reproduce the stale assertion with `node --test --experimental-test-isolation=none tests/unit/workspace-sa-rollback-auth.test.mjs`: executor returned the required `INVALID_TOKEN`, but the test expected `UNAUTHENTICATED`. Update only that expectation; preserve the revoked-credential denial and both bound/unbound cases. The pre-fix red run is diagnostic evidence, not a final test result.
- [x] Reproduce strict OpenSpec failure, then add revoked-JWT and missing/opaque-credential scenarios to the safe-failure requirement. Strict validation now passes.
- [x] Document control-plane public `tokenEndpoint`/`callbackUrl` changes in design.md and linked upgrade notes, with pending R3 assessment.
- [x] Document that tenant audience enforcement adds control-plane rejections, and require evidence of mapper coverage for all existing tenant app/console clients.
- [x] Record the missing control-plane migration and effective prod-TLS trust-base fixes as companion deployment prerequisites, including required regression tests and release notes. No deployment files are changed by this source maker.
- [x] Run the 15 files listed above plus `workspace-sa-rollback-auth.test.mjs`, `workspace-sa-rollback.test.mjs` and `tenant-social-provider.test.mjs` with `node --test` and no timeout wrapper: 18/18 files pass in default subprocess mode. Also run the repaired rollback-auth file alone, strict OpenSpec validation, Markdown lint and `git diff --check`.

## Outstanding rollout tasks for #1505

- [ ] Deployment maker: extend the paused atomic env migration/runbook to the control-plane Deployment/container, testing literal issuer/JWKS entries and duplicate prod-TLS JWKS entries as well as the executor. Publish operator release notes; preserve existing guards and checksums.
- [ ] Deployment maker: derive the internal trusted realm base from the effective JWKS URL after TLS overrides. Add prod-TLS render assertions for the HTTPS base and absence of the stale HTTP alias, alongside shared-config parity tests.
- [ ] Operator/R3 review: assess the new public service-account token endpoint and social-provider callback URL, and explicitly approve any temporary platform `account` audience. Approval is not supplied by this source change.
- [ ] Operator: confirm audience mapper coverage on every existing tenant app and console client before enabling shared tenant-audience enforcement, and confirm platform console mapper reconciliation.
- [ ] Operator, due 2026-11-14: remove `account` from the explicit platform audience list after existing sessions refresh/expire; verify strict `in-falcone` acceptance and `account`-only denial. This task tracks removal; the deadline is not enforced automatically.
- [ ] PR/release CI and operator: run companion chart migration/render checks, image builds/scans and live superadmin/tenant-owner flows/MCP checks. No network, Docker/image infrastructure or live-session credentials are available to this source maker.
