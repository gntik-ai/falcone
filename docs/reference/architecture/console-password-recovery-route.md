# Console password recovery route

The web console login page exposes the password-recovery entry point configured by
`consoleAuthConfig.passwordRecoveryPath`, which defaults to `/password-recovery`.
That route is public and unauthenticated, like `/login` and `/signup`.

## Route behavior

`/password-recovery` renders `PasswordRecoveryPage` instead of falling through to
the root NotFound route. The page provides:

- A username-or-email field that maps to the published public auth contract field
  `usernameOrEmail`.
- A primary action to send recovery instructions through
  `POST /v1/auth/password-recovery-requests`.
- A back action to return to `/login`.

The page does not reset a password directly. It only starts the recovery request
that the public OpenAPI contract already advertises.

## Runtime availability

The public contract includes:

```text
POST /v1/auth/password-recovery-requests
POST /v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations
```

Some local kind runtimes may not yet register those password-recovery handlers.
When the request endpoint returns `404`, the console keeps the user on the real
recovery view and shows a clear "not enabled in this environment" message. It
does not route to NotFound and does not present a successful reset.

Successful `202` responses render the accepted ticket state from the contract,
including the recovery status, masked destination, and expiration timestamp. The
copy remains account-enumeration safe: the console states that instructions are
sent only if the account exists and can recover its password.
