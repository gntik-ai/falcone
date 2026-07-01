# Tasks

## 1. Reproduce / encode the issue

- [x] Parse issue #740 acceptance criteria:
  - Requirement: IAM page matches the role's actual permissions.
  - Scenario: WHEN a tenant owner opens `/console/auth`, THEN they either do not see the entry if it
    is superadmin-only OR they can view/manage their own tenant realm's roles/clients; not a
    `403 requires superadmin` dead-end.
- [x] Confirm root cause from source:
  - `ConsoleShellLayout` listed Auth for all sessions.
  - `router.tsx` rendered `/console/auth` directly.
  - `ConsoleAuthPage` loads superadmin-only IAM inventory routes and can surface the resulting 403.
- [x] Add focused web-console regression coverage for the issue scenario and superadmin controls.

## 2. Fix

- [x] Hide the Auth navigation item for non-superadmin sessions.
- [x] Guard direct `/console/auth` access with `RequireSuperadminRoute`.
- [x] Leave superadmin behavior unchanged.
- [x] Do not widen backend IAM privileges or alter IAM routes for this issue.

## 3. Wire / docs / spec

- [x] Confirm no backend, OpenAPI/AsyncAPI, generated client, shared type, or wire-shape change is
  required.
- [x] Materialize the issue's OpenSpec delta under `web-console`.
- [x] Add a concise architecture docs note for the current `/console/auth` permission model.

## 4. Verification

- [x] Run focused web-console tests changed by this fix.
- [x] Run `openspec validate fix-740-auth-iam-permission-gate --strict`.
- [x] Run `npm run generate:public-api` and confirm no tracked diff.
- [x] Run `git diff --check` before commit and `git diff --check origin/main...HEAD` after commit.
- [x] Run the full web-console test suite if cheap/available, or record any unrelated baseline
  limitation.
