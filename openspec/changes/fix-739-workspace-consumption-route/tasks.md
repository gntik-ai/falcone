## 1. Backend And Runtime

- [x] 1.1 Add `GET /v1/workspaces/{workspaceId}/consumption` to
  `deploy/kind/control-plane/route-map.runtime.json`.
- [x] 1.2 Make the self route explicit in
  `deploy/kind/control-plane/route-map.json` instead of mentioning it only in
  the admin route notes.
- [x] 1.3 Add matching self and explicit tenant routes to
  `tests/env/action-runner/routes.mjs`.
- [x] 1.4 Update `workspace-consumption-get.mjs` so tenant owners resolve
  `tenantId` from the trusted caller context when the path has no tenant segment.
- [x] 1.5 Preserve superadmin/internal explicit-tenant requirements,
  cross-tenant denial, and workspace-admin workspace scoping.

## 2. Web Console

- [x] 2.1 Render successful workspace consumption and capabilities unchanged.
- [x] 2.2 Render a clean unavailable state when consumption cannot be retrieved.
- [x] 2.3 Do not display raw backend `NO_ROUTE` or `No action mapped` strings.

## 3. Specs And Docs

- [x] 3.1 Add OpenSpec deltas for `quotas-plans` and `web-console`.
- [x] 3.2 Add architecture documentation for workspace consumption route parity
  and clean console degradation.
- [x] 3.3 Leave OpenAPI, generated SDKs, and shared response types unchanged
  because the route already exists in gateway configuration and the response
  schema is unchanged.

## 4. Verification

- [x] 4.1 Run focused route/action backend tests.
- [x] 4.2 Run focused web-console tests.
- [x] 4.3 Run OpenSpec validation if the CLI is available.
- [x] 4.4 Run public API generation/diff check if feasible.
- [x] 4.5 Run `git diff --check`.
