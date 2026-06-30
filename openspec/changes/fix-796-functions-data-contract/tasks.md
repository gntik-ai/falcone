## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #796 acceptance criteria:
  - Requirement: Data: Functions console drives the functions API per contract.
  - Scenario A: deploys from `/console/functions/data` must call `POST /v1/functions/actions` with a
    contract-compatible body and must not hit `404 NO_ROUTE`.
  - Scenario B: listed rows show `actionName` and `execution.runtime`; Invoke and Activations use
    `resourceId`, never `undefined`.
- [x] 1.2 Confirm contract source of truth in this checkout:
  - list is `GET /v1/functions/workspaces/{workspaceId}/actions`;
  - deploy is `POST /v1/functions/actions`;
  - invoke is `POST /v1/functions/actions/{resourceId}/invocations`;
  - activations is `GET /v1/functions/actions/{resourceId}/activations`.
- [x] 1.3 Update focused tests so the broken workspace POST route and legacy `name`/`runtime`
  selection behavior are red on current main and green on this branch.

## 2. Implement the minimal frontend fix

- [x] 2.1 Update `apps/web-console/src/services/functionsApi.ts` types and route helpers to match the
  published functions API contract.
- [x] 2.2 Translate the simple JSON editor's legacy deploy shape to a function action write request,
  while preserving already contract-shaped JSON and stamping the selected `tenantId` and
  `workspaceId`.
- [x] 2.3 Wrap plain invocation payloads in an invocation request envelope and preserve existing
  invocation envelopes.
- [x] 2.4 Update `FunctionsConsole` to render `actionName`/`execution.runtime`, select by
  `resourceId`, and validate deploy JSON with `actionName` or legacy `name`.

## 3. Wire / contract / docs

- [x] 3.1 Confirm no backend, OpenAPI, or generated client change is required because the existing
  contract artifacts already declare the correct functions routes.
- [x] 3.2 Add this OpenSpec change under `openspec/changes/fix-796-functions-data-contract/`.
- [x] 3.3 Add a concise architecture reference documenting the Data: Functions console contract
  mapping.

## 4. Verify

- [x] 4.1 Run focused web-console tests for `functionsApi` and `FunctionsConsole`.
- [ ] 4.2 Run `pnpm --filter @in-falcone/web-console test` if local dependencies are available or can
  be installed with the frozen lockfile. Attempted locally after `pnpm install --frozen-lockfile`;
  issue-specific tests passed, but the full suite failed in unrelated `localStorage`-dependent
  suites under Node 26.
- [x] 4.3 Run `openspec validate fix-796-functions-data-contract --strict` if the OpenSpec CLI is
  available.
- [x] 4.4 Run `npm run generate:public-api` and confirm no generated artifact drift.
- [x] 4.5 Run `git diff --check`.
