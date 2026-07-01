# fix-727-login-401-credentials-message

## Why
The web console `/login` page treated only HTTP `400` and `403` login failures as credential
errors. A real wrong-password attempt against `POST /v1/auth/login-sessions` returns HTTP `401`
with `code: INVALID_CREDENTIALS`, so the console fell through to the operational outage copy
("El servicio de acceso no está disponible ahora mismo"). Users with mistyped credentials were told
the access service was unavailable instead of being given a credential-specific correction path.
(GitHub issue #727.)

## What Changes
- Classify HTTP `401` login failures, and explicit `INVALID_CREDENTIALS` error codes, as
  credential failures in `apps/web-console/src/pages/LoginPage.tsx`.
- Keep the service-unavailable feedback for operational failures such as `5xx` responses or
  network-style request failures.
- Preserve the existing `400`/`403` credential handling behavior, including its current use of the
  backend message when present.
- Add focused `LoginPage` regression coverage for the issue's WHEN/THEN: `401 INVALID_CREDENTIALS`
  shows the credential-specific alert and does not show the service-outage heading. The test suite
  also checks that a `503` login failure still shows the service-unavailable alert.
- Add a human architecture note documenting the web console login error classification.

## Out of scope
- No backend, OpenAPI, generated SDK/client, shared type, or route-contract change is required; the
  wire already carries HTTP `401` plus the existing `INVALID_CREDENTIALS` error code.
- No live-cluster deployment or mutation is performed because the active kube context is not a local
  `kind-*` context for this run.
