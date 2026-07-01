# Tasks — fix-727-login-401-credentials-message

## 1. Reproduce
- [x] Confirm `apps/web-console/src/pages/LoginPage.tsx` classifies only HTTP `400`/`403` login
      failures as credential errors, causing `401 INVALID_CREDENTIALS` to fall through to the
      service-unavailable feedback.
- [x] Use the independently confirmed live read-only reproduction from issue #727 as the grounding
      evidence: wrong credentials returned `401 INVALID_CREDENTIALS` while the console rendered the
      service-outage heading.

## 2. Fix
- [x] Add a focused login-page classifier for credential failures that includes HTTP `401` and
      explicit `INVALID_CREDENTIALS` codes.
- [x] Keep the operational service-unavailable feedback for `5xx` and network-style failures.
- [x] Preserve existing `400`/`403` credential handling behavior.

## 3. Tests
- [x] Add a regression test for the issue scenario: `POST /v1/auth/login-sessions` returns
      `401 INVALID_CREDENTIALS`, the console shows the credentials alert, and the outage heading is
      absent.
- [x] Add a focused guard that a `503` login failure still shows the service-unavailable alert.

## 4. Scope / contract discipline
- [x] No backend handler, OpenAPI/AsyncAPI artifact, generated client/SDK, or shared wire type is
      changed; this is a frontend classification fix for an existing response shape.

## 5. Docs
- [x] Document the console login error classification in
      `docs/reference/architecture/console-login-error-classification.md`.
