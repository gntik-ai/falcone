# Change: fix-726-password-recovery-route

## Why

Issue #726 is a confirmed unauthenticated web-console navigation bug. The login
page renders "¿Olvidaste tu contraseña?" as a link to
`consoleAuthConfig.passwordRecoveryPath` (default `/password-recovery`), but the
router had no matching public route. An unauthenticated user who clicked the link
fell through to the root `*` route and saw `NotFoundPage`, creating a dead end
for password recovery.

The public auth OpenAPI already advertises password-recovery request and
confirmation endpoints. The kind runtime does not currently register those
handlers, so this change must not fake a completed backend reset.

## What Changes

- Add a public unauthenticated `/password-recovery` route to the web-console
  router.
- Add `PasswordRecoveryPage`, a real recovery-entry view with:
  - a username/email field and submit action;
  - a back action to `/login`;
  - a call to the already-published
    `POST /v1/auth/password-recovery-requests` contract;
  - explicit 404/unavailable handling when the runtime does not expose the
    recovery endpoint.
- Add `createConsolePasswordRecoveryRequest` and typed request/ticket shapes to
  `apps/web-console/src/lib/console-auth.ts`, matching the existing OpenAPI
  contract without changing the contract source.
- Add focused web-console regression tests for the issue scenario and request
  behavior.
- Document the console password-recovery route behavior.

## Scope and Wire

This is a frontend/web-console fix plus documentation and OpenSpec. It does not
change backend routes, status codes, request/response schemas, OpenAPI source,
generated public API artifacts, gateway routes, or shared contract artifacts.
Public API generation is rerun to confirm no generated diff.
