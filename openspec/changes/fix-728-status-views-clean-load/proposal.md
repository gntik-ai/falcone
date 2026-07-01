# Change: fix-728-status-views-clean-load

## Why

Issue #728 is a confirmed unauthenticated web-console clean-load bug. The
`PendingActivationPage` calls
`GET /v1/auth/status-views/pending_activation` through
`getConsoleAccountStatusView('pending_activation')`, but the kind control-plane
runtime did not register `GET /v1/auth/status-views/{statusViewId}`. A normal
load of `/signup/pending-activation` therefore predicted a runtime
`404 NO_ROUTE` for an endpoint the SPA depends on.

Acceptance criteria from the issue:

- Requirement: The system SHALL keep console status-views calls and
  control-plane routes in sync, so a normal page load produces no 404 for an
  endpoint the SPA depends on.
- Scenario: WHEN an unauthenticated user opens
  `/signup/pending-activation` THEN the page renders without firing a 404
  request for `status-views/pending_activation`.

## What Changes

- Add a public `getConsoleAccountStatusView` local auth handler in the kind
  control-plane runtime.
- Return the published `ConsoleAccountStatusView` shape for the six canonical
  status-view ids: `login`, `signup`, `pending_activation`,
  `account_suspended`, `credentials_expired`, and `password_recovery`.
- Return `404 { code: "STATUS_VIEW_NOT_FOUND", ... }` for unknown status-view
  ids.
- Register `GET /v1/auth/status-views/{statusViewId}` with `auth: "public"` in
  `deploy/kind/control-plane/routes.mjs`.
- Add the same local-handler route to `route-map.runtime.json`, which is loaded
  by the kind image, and update the `route-map.json` catalog entry so it no
  longer marks the route as a gap.
- Add pure Node regression tests for route matching and handler behavior.
- Document the account status-view runtime route.

## Scope and Wire

This is a backend/runtime route parity fix. It preserves frontend behavior: the
SPA already calls the published route and falls back to local copy when the
request fails. No frontend source change is needed.

The public OpenAPI contract already advertises
`GET /v1/auth/status-views/{statusViewId}`, the `ConsoleStatusViewId` enum, the
`ConsoleAccountStatusView` response schema, and the `404` error response. No
OpenAPI, generated SDK, or shared type change is needed; public API generation
is rerun to confirm no tracked generated diff.
