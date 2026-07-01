# Tasks: fix-726-password-recovery-route

## 1. Reproduce and scope

- [x] Confirm `consoleAuthConfig.passwordRecoveryPath` defaults to
      `/password-recovery`.
- [x] Confirm `LoginPage` links "¿Olvidaste tu contraseña?" to that path.
- [x] Confirm the router lacked `/password-recovery` and root `*` rendered
      `NotFoundPage`.
- [x] Confirm the public auth contract already advertises
      `POST /v1/auth/password-recovery-requests` and confirmation routes.

## 2. Fix

- [x] Add a public unauthenticated `/password-recovery` route.
- [x] Add a recovery-entry page with a way to proceed and a way back to `/login`.
- [x] Wire the request form to the published
      `POST /v1/auth/password-recovery-requests` contract.
- [x] Handle runtime `404`/unavailable recovery endpoints clearly without
      falling to NotFound or faking a successful backend reset.

## 3. Tests

- [x] Add a login-link navigation regression test for the issue's WHEN/THEN.
- [x] Add a production router test proving `/password-recovery` renders a real
      public page rather than NotFound.
- [x] Add page-level tests for request success and 404/unavailable handling.

## 4. Docs, OpenSpec, and contract discipline

- [x] Add this OpenSpec change under
      `openspec/changes/fix-726-password-recovery-route/`.
- [x] Document the route behavior in
      `docs/reference/architecture/console-password-recovery-route.md`.
- [x] Leave the API contract source unchanged and rerun public API generation to
      confirm no generated diff.

## 5. Verification

- [x] Run focused web-console Vitest checks for login, password recovery, and the
      router.
- [x] Run OpenSpec validation for this change.
- [x] Inspect final git diff/status before commit.
