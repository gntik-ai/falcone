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

Run all verifier, identity, workspace-binding, tenant-audience, revocation and realtime API-key/SSE regression suites with Node's test isolation disabled. The recorded command is the same invocation used for the final source tree; the structured result reports its final outcome. No timeout wrapper is used. The initial broader run passed 776 tests; two added tenant-owner HTTP controls bring the final corpus to 778 tests.

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

- Node's default test subprocess mode cannot execute in this sandbox. Use `--experimental-test-isolation=none` for the passing bounded run.
- `tests/unit/control-plane-jwt-identity.test.mjs` cannot initialize its TCP listener: `listen EPERM: operation not permitted 127.0.0.1`. Report SKIPPED, not an assertion failure. The generated-token in-memory HTTP tests cover both affected routes without binding a socket. PR CI must run socket-based identity suites.
- Image builds and deployment chart render/provisioning tests are not run by this source maker. They require the separate deployment repository/CI and Docker infrastructure.
- The deployment maker must consume the exact new env contract, reconcile the console mapper on existing realms, preserve ConfigMap/valueFrom/migration/checksum safeguards and add render parity tests. Tenant audience enforcement requires the corresponding mapper on tenant console/app clients.
- The operator must confirm live superadmin and tenant-owner flows/MCP behavior after normal delivery and remove the explicit rollout audience by the documented deadline. Independent review must assess the issue's R3 concern and the account-audience compatibility decision against supplied R1 policy.
- No dependencies, lockfiles, workflow pins, credentials, deployment state or unrelated source files change. Commit locally; do not push, merge or deploy.
