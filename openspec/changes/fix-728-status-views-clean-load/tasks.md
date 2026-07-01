# Tasks: fix-728-status-views-clean-load

## 1. Reproduce and scope

- [x] Confirm `PendingActivationPage` calls
      `getConsoleAccountStatusView('pending_activation')`.
- [x] Confirm the public OpenAPI contract already advertises
      `GET /v1/auth/status-views/{statusViewId}` and
      `ConsoleAccountStatusView`.
- [x] Confirm `deploy/kind/control-plane/routes.mjs` and
      `route-map.runtime.json` lacked the status-view route, causing
      `NO_ROUTE`.

## 2. Runtime fix

- [x] Add a dependency-free public auth local handler for canonical console
      account status views.
- [x] Register `GET /v1/auth/status-views/{statusViewId}` in the seed route
      table with `auth: "public"`.
- [x] Add the same local-handler route to `route-map.runtime.json`.
- [x] Update `route-map.json` so `getConsoleAccountStatusView` no longer says
      `GAP`.

## 3. Tests

- [x] Add a pure route-matcher test proving
      `GET /v1/auth/status-views/pending_activation` resolves to the local
      handler in both seed routes and runtime route map.
- [x] Add direct handler tests for `pending_activation`, every contract enum
      status view, and unknown status-view `404 STATUS_VIEW_NOT_FOUND`.

## 4. Docs and OpenSpec

- [x] Materialize this OpenSpec change under
      `openspec/changes/fix-728-status-views-clean-load/`.
- [x] Add a focused architecture reference for console account status views.
- [x] Keep frontend/OpenAPI/SDK artifacts unchanged because the route is
      already in the public contract.

## 5. Verification

- [x] Run the focused Node regression test.
- [x] Run OpenSpec validation for this change.
- [x] Run `npm run validate:openapi`.
- [x] Run `npm run validate:public-api`.
- [x] Run `npm run generate:public-api` and confirm no tracked generated diff.
- [x] Run `git diff --check origin/main...HEAD`.
