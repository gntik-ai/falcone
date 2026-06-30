## Why

The Service Accounts page (`/console/service-accounts`) built its list from a per-browser
`sessionStorage` index. A tenant owner who opened the console in a fresh browser/session could see an
empty state even when the workspace already had service accounts created elsewhere.

The backend collection route already exists at `GET /v1/workspaces/{workspaceId}/service-accounts`.
The console must use that route as the workspace source of truth instead of requiring browser-local
known IDs before it lists anything.

## What Changes

- **Web console**
  - `useConsoleServiceAccounts` now calls `GET /v1/workspaces/{workspaceId}/service-accounts` for the
    list view and normalizes the returned `items`.
  - The local known-ID helpers remain for create/delete compatibility, but no longer gate the list
    request or empty state.
  - The Service Accounts empty/loading copy now describes workspace-backed loading instead of
    browser-local known state.
- **Backend / wire**
  - The local collection handler returns console-listable service-account items in the same response
    envelope used by other collection helpers, while preserving legacy raw row fields for
    compatibility.
  - The OpenAPI source now documents `GET /v1/workspaces/{workspaceId}/service-accounts`, and the
    generated family OpenAPI, public route catalog, and public API surface docs are regenerated.
- **Tests**
  - A focused web-console hook test encodes the issue scenario: with empty `sessionStorage`, the hook
    calls the collection route and lists backend service accounts.
  - A page test guards against reintroducing browser-local empty-state wording.
  - A local backend handler test covers the collection response shape used by the console.
- **Docs**
  - The service-account lifecycle guide documents the collection endpoint and states that the console
    uses it independently of browser/session state.

## Capabilities

### Modified Capabilities

- `web-console`: Service Accounts page list loading is backed by the workspace collection endpoint.
- `access-control`: service-account collection route is documented in the public API contract and
  route catalog as a workspace-scoped control-plane read.
