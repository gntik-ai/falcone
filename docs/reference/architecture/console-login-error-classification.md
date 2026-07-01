# Console login — error classification

The web console login page (`apps/web-console/src/pages/LoginPage.tsx`) submits credentials through
`createConsoleLoginSession` (`POST /v1/auth/login-sessions`,
`apps/web-console/src/lib/console-auth.ts`). The endpoint returns the platform error envelope
(`status`, `code`, `message`, optional details), and the public OpenAPI contract advertises the
wrong-credentials case as HTTP `401` with the shared `ErrorResponse` schema. This document defines
how the console maps that envelope into user-facing login feedback.

## Classification rules

The login page handles account-status transitions first:

- HTTP `409` responses with a known status view (`pending_activation`, `account_suspended`,
  `credentials_expired`, or related detail/code aliases) render the corresponding account-status
  guidance and action.

After account-status handling, credential failures render the credentials alert:

- HTTP `400` and HTTP `403` keep the historical behavior: the alert title is
  `No hemos podido validar tus credenciales`, and the backend message is used when present.
- HTTP `401` renders the same credentials alert title with the friendly message
  `Revisa tu usuario y contraseña e inténtalo de nuevo.`
- Any response whose error code is exactly `INVALID_CREDENTIALS` is treated as a credential failure,
  even if a future backend changes the status code.

Operational failures render the service-unavailable alert:

- HTTP `5xx` responses, network failures, and other non-credential operational failures use
  `El servicio de acceso no está disponible ahora mismo`.

## Contract impact

This is a frontend classification rule for an existing runtime wire shape. It does not add or
change endpoints, generated clients, SDKs, or shared types. The public OpenAPI contract for
`createConsoleLoginSession` documents the existing HTTP `401` invalid-credentials response as an
`ErrorResponse`, and the generated auth family/public API artifacts are kept in sync with the
aggregate contract. The API continues to report invalid login attempts as HTTP `401` with
`code: INVALID_CREDENTIALS`; the console is responsible for presenting that as a wrong-credentials
outcome rather than a service outage.
