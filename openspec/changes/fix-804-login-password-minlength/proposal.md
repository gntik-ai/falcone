# fix-804-login-password-minlength

## Why
The web console `/login` password field hardcodes a client-side `minLength={12}`
(`apps/web-console/src/pages/LoginPage.tsx`), but the platform password policy minimum is **8**
(`GET /v1/auth/signups/policy` → `passwordPolicy.minLength: 8`, live-confirmed). A user whose
password is a policy-valid 8–11 characters trips the browser's native constraint validation
(`validity.tooShort`); the login form (which has no `noValidate`) never submits, and
`POST /v1/auth/login-sessions` is never sent. Those accounts are locked out of the console even
though their password satisfies the platform policy. (GitHub issue #804.)

## What Changes
- Remove the hardcoded `minLength={12}` from the **login** password `<Input>` in
  `apps/web-console/src/pages/LoginPage.tsx`. The login form authenticates an **existing**
  credential, so it must impose no client-side length floor that can exceed (or drift from) the
  platform password policy and block policy-valid accounts; the backend / Keycloak policy stays
  authoritative. `required` and `maxLength={256}` are kept.
- This is the issue's explicitly-sanctioned "impose no client-side minimum on login" option. It is
  a **pure frontend change** with **no contract change**: no OpenAPI/SDK/route-catalog/gateway or
  backend artifact is touched, and the `ConsoleSignupPolicy` type is unchanged (codegen no-diff).
- Add regression tests in `apps/web-console/src/pages/LoginPage.test.tsx` (the CI `web-console`
  vitest job is the executed gate): an attribute-level assertion that the login password field
  imposes no client-side minimum greater than the policy minimum, and a behavioral test that an
  8-character policy-valid password submits and sends `POST /v1/auth/login-sessions`.

## Out of scope
- The identical hardcoded `minLength={12}` on the **signup** password field
  (`apps/web-console/src/pages/SignupPage.tsx:243`) is tracked separately by **#725** and is left
  untouched here (signup is currently unreachable).
