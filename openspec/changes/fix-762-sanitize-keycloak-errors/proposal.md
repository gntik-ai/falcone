# Change: fix-762-sanitize-keycloak-errors

## Why

Issue #762 confirmed that Keycloak-backed IAM mutation failures could leak raw Keycloak admin
request lines and upstream response bodies into the public control-plane error envelope. The kind
control-plane Keycloak adapter threw messages like `keycloak METHOD /realms/... -> status: body`,
IAM handlers copied `String(e.message ?? e)` into the API `message`, the web-console HTTP client
preserved that field, and the IAM Access page rendered it verbatim.

That exposes internal identity-provider paths, tenant realm identifiers in URL form, and upstream
Keycloak response bodies to API callers and console users.

## What Changes

- Represent Keycloak admin failures with a caller-safe public `message` and stable internal error
  marker while keeping method, path, upstream status, and body as non-enumerable server diagnostics.
- Map IAM and Keycloak-admin-backed handler failures through the safe message helper while retaining
  their existing stable domain `code`s and compatible status behavior.
- Add domain error handling for Keycloak-backed service-account credential mutations that previously
  could fall through to the generic control-plane exception mapper.
- Update the IAM Access page to localize known IAM failure codes and fall back instead of echoing raw
  Keycloak admin details.
- Add backend and frontend regression tests covering upstream Keycloak 404 mutation failures and
  negative assertions for `keycloak `, `/realms/`, and upstream response-body text.
- Document sanitized Keycloak-backed IAM error handling in the public control-plane API docs.

## Scope

This change does not alter request shapes, response envelope fields, authentication claims,
pagination/filter parameters, OpenAPI schema structure, AsyncAPI events, or generated client types.
The public wire contract remains `{ code, message }` for errors; the semantics of `message` are
tightened so upstream Keycloak details are not caller-visible.

## Capabilities

### Modified Capabilities

- `iam-admin`: Keycloak-admin-backed IAM/API failures return stable domain codes with sanitized
  caller-safe messages.
- `web-console`: the IAM Access page renders friendly localized alerts for IAM mutation failures
  instead of echoing raw backend details.
