## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #788 acceptance criteria:
  - Requirement: The system SHALL serve `GET /v1/workspaces/{workspaceId}/realtime` for the shipped
    realtime config page, or not ship that page.
  - Scenario: WHEN a tenant owner opens the workspace realtime page, THEN the config request reaches
    a real handler and the page renders realtime metadata/snippets instead of `404 NO_ROUTE`.
- [x] 1.2 Confirm root cause from source:
  - `ConsoleRealtimePage` calls `/v1/workspaces/{workspaceId}/realtime`.
  - The web-console route is registered.
  - The shipped kind route table and runtime map do not register that backend route.
- [x] 1.3 Add focused tests covering route matching and handler response shape.

## 2. Fix

- [x] 2.1 Add a kind control-plane local handler for workspace realtime config.
- [x] 2.2 Register `GET /v1/workspaces/{workspaceId}/realtime` in the seed route table.
- [x] 2.3 Update runtime route-map metadata so the kind image carries the route.
- [x] 2.4 Preserve tenant isolation by resolving the workspace first and comparing its tenant to
  the verified caller tenant before querying `realtime_channels`.

## 3. Wire / frontend / docs

- [x] 3.1 Confirm no public OpenAPI, generated SDK, or route-catalog contract change is required;
  this route is consumed by the console and kind control-plane metadata, not the published public
  client artifacts.
- [x] 3.2 Add a web-console regression test for a successful empty realtime config response.
- [x] 3.3 Add `docs/reference/architecture/workspace-realtime-console.md`.
- [x] 3.4 Materialize this OpenSpec change.

## 4. Verify

- [x] 4.1 Run the focused Node unit test:
  `node --test tests/unit/workspace-realtime-config-route.test.mjs`.
- [x] 4.2 Run the focused web-console test:
  `pnpm --filter @in-falcone/web-console test -- ConsoleRealtimePage.test.tsx`.
- [x] 4.3 Run OpenSpec validation:
  `openspec validate fix-788-workspace-realtime-config-route --strict`.
- [x] 4.4 Run public API generation / OpenAPI validation and confirm no generated diff.
- [ ] 4.5 Deploy to the designated kind test cluster and verify against live deployment URLs.
  This remains gated by availability of a safe `kind-*` test context.
