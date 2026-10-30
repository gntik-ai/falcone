# Scope platform console sessions to the executor path workspace

## Why

Issue #1492 has two confirmed causes. The executor verifies platform-realm console JWTs but derives their tenant only from `tenant_id`; a superadmin session without that claim therefore gets `401 UNAUTHENTICATED: Missing tenant identity` on the flows list. In web-console-next, a domain-route 401 that survives one refresh and replay invokes the session-ending handler because the three flows requests omit `suppressUnauthorizedInvalidation`.

At immutable base `8bd1bc8a1db3a04652fe0acbd6044e073cdff06b`, `node tests/blackbox/executor-platform-caller-identity.test.mjs` reproduced the exact 401 twice using an RS256 platform token, stub JWKS and the real executor request listener. The public seam is HTTP routing and response, with the flow service replaced at its boundary. The reduced scenario needs only the trusted token, existing workspace owner resolver and flows list handler. Listening sockets are denied, so the regression uses the repository's in-memory HTTP parser helper.

The diagnostic hypotheses were: missing tenant derivation for platform sessions (predicts this 401 with a verified token); failed JWT trust/audience verification (predicts rejection before identity exists); and workspace credential mismatch (predicts 403 once identity exists). The deterministic 401 and successful verified platform identity establish the first cause. Console tests separately observed the session-ending handler called once after exactly two domain requests and one successful refresh.

## What changes

- Mirror the control-plane actor mapping and claim precedence only after verification of a platform issuer. `superadmin` and `platform_admin` map to `superadmin`; `platform_operator` maps to `internal`. The verified `actor_type` claim also takes precedence, exactly as in the control plane. Mark platform actors with `platformCaller` and retain `actorType` in the identity passed to handlers.
- For those verified platform callers without a tenant, resolve the owner of the workspace in the matched path before the missing-tenant gate. Reuse that ownership result in the later tenant gate. Unknown workspaces and resolver failures return 404 `NOT_FOUND` with no handler execution. Missing resolvers and paths without a workspace retain 401. Never take this scope from a claim, body or header.
- Keep tenant-issuer identity, legacy issuer behavior, API keys, gateway headers, invalid workspace binding, credential binding, hosted MCP scope, cross-tenant ownership and structural/role gates intact. Signed tests pin the full mirrored actor mapping and precedence.
- Suppress repeated domain-401 invalidation only for flows list, draft creation and run-now. Show the existing localized `errors.401` message for list failures. The shared session client and refresh-failure behavior stay unchanged.
- Add platform-superadmin parity coverage with no tenant membership and repeated-401 journeys for all three requests. Fixtures are synthetic; browser fixtures do not verify JWTs. Signed executor tests cover that boundary.

## Other session-ending request callers (PR inventory)

All these existing web-console-next callers omit suppression and can invoke the bootstrap-installed session-ending handler on an endpoint 401 after successful refresh. They are unchanged:

| Caller | Requests |
| --- | --- |
| `consoleDocs/api.ts` | Read workspace docs; create, update and delete notes |
| `consoleFunctionRegistry.tsx` | List and create workspace functions |
| `consoleMcpServerDetail/api.ts` | Read server details and invoke tools |
| `consolePlanCatalog/api.ts` | List plans |
| `consolePlanCreate/api.ts` | Create plans |
| `consoleTenantAllocationSummary/api.ts` | Read tenant allocation summary |
| `consoleTenants/api.ts` | List active plans; read platform tenant quota and overview metrics |
| `consoleRuntime/api.ts` | Read Knative runtime status |
| `consoleOperations/query.ts` | Query operation lists |
| `operationDetail/query.ts` | Query operation details/history |
| `consoleOperations/reconnect.ts` | Probe `/v1/console/session` on reconnect (a session endpoint) |

`consoleFlowHistory/api.ts` already suppresses domain-401 invalidation. The legacy `apps/web-console/src/services/flowsApi.ts` uses the same executor URL and shared client, so the backend bug affects it too and this backend fix covers it. Legacy bootstrap never installs `setConsoleSessionRetryUnauthorizedHandler`; a repeated endpoint 401 rejects the request without that next-only session-ending hook. A failed refresh still invalidates the shared session. No legacy change is needed.

## Limits and review

The supplied risk policy is R1; the checker should assess the issue's R2 concern because all workspace-addressed executor routes share this gate. Legacy trust remains fail-closed. Accepting `actor_type` on its own follows the approved control-plane mapping and is limited to the verified platform issuer. No JWT is reparsed in the server. No Keycloak, gateway, Helm, dependency, workflow pin or deployment change is needed. The separate deployment worktree is untouched.

Browser parity, axe and viewport checks run in PR CI because Chromium is unavailable here. The independent checker and operator must assess parity screenshots. Live staging verification is operator-owned after normal delivery. Roll back by reverting the ChangeSet; no migration is needed.
