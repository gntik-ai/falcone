# Tasks

## 1. Reproduce / encode the issue

- [x] Parse issue #762 acceptance criteria:
  - Requirement: API errors do not leak internal/upstream details.
  - Scenario: WHEN a Keycloak admin call inside an IAM or other kc-admin-backed handler returns
    non-2xx, THEN the API returns a sanitized domain error with stable `code`, caller-safe
    `message`, and no raw Keycloak request/body details; the console renders a friendly localized
    alert.
- [x] Confirm root cause from source:
  - `kc-admin.mjs` threw raw `keycloak ${method} ${path} -> ${status}: ${body}` messages.
  - `b-handlers.mjs` copied `String(e.message ?? e)` into IAM/client-facing errors.
  - `ConsoleIamAccessPage.tsx` rendered the preserved backend `message` directly.
- [x] Add backend regression coverage for upstream Keycloak 404 mutation errors with negative
  assertions for `keycloak `, `/realms/`, and upstream body text.
- [x] Add web-console regression coverage for the IAM Access role-assignment alert.

## 2. Fix

- [x] Add a safe Keycloak admin error representation with non-enumerable upstream diagnostics.
- [x] Sanitize Keycloak-backed handler error messages while retaining stable domain `code`s.
- [x] Cover IAM mutations for superadmin and authenticated tenant owner/admin style callers.
- [x] Add domain-code mappings for service-account credential Keycloak failures that previously
  could fall through to generic control-plane errors.
- [x] Update the IAM Access page to localize known IAM failures and avoid echoing raw Keycloak
  strings.

## 3. Wire / docs / spec

- [x] Confirm no OpenAPI/AsyncAPI schema, generated client, shared type, request shape, response
  field, or status-code generation change is required.
- [x] Materialize the issue's OpenSpec delta under `iam-admin` and `web-console`.
- [x] Update public control-plane API docs for sanitized Keycloak-backed IAM errors.

## 4. Verification

- [x] Run focused backend regression tests.
- [x] Run focused web-console regression tests.
- [x] Run `openspec validate fix-762-sanitize-keycloak-errors --strict`.
- [x] Run public API generation/validation checks for wire drift.
- [x] Run `git diff --check` and commit the branch.
