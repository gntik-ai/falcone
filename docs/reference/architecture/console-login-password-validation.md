# Console login — password length validation

The web console login page (`apps/web-console/src/pages/LoginPage.tsx`) authenticates an
**existing** credential against the control plane via
`createConsoleLoginSession` (`POST /v1/auth/login-sessions`,
`apps/web-console/src/lib/console-auth.ts`). This page documents the one invariant that keeps
policy-valid accounts from being locked out of login by the browser.

## The login form imposes no client-side password length floor

The login password `<Input>` carries `required` and `maxLength={256}` but **no** `minLength`. It
deliberately does not enforce a client-side minimum length.

A login form validates a credential that already exists; the **platform password policy is
authoritative** (enforced by the backend / Keycloak at credential creation, and the backend rejects
bad credentials at `POST /v1/auth/login-sessions`). The platform minimum is exposed to clients via
`GET /v1/auth/signups/policy` (`passwordPolicy.minLength`).

A hardcoded client-side `minLength` on the login field is a defect because:

- The login `<form>` does not set `noValidate`, so the browser runs native constraint validation on
  submit. A password shorter than a hardcoded `minLength` makes the field `:invalid`
  (`validity.tooShort`), so the form **never submits** and **no** `POST /v1/auth/login-sessions`
  request is sent.
- If that hardcoded floor is **larger than** the policy minimum (or drifts from it), every account
  whose password is policy-valid but below the hardcoded floor is silently locked out of console
  login — with a native length-validation bubble instead of a real credential check. This was the
  case when the field hardcoded `minLength={12}` while the policy minimum was `8`: accounts with
  policy-valid 8–11-character passwords could not sign in (#804).

**Rule:** the login password field MUST NOT impose a client-side minimum length that exceeds the
platform password policy minimum (`/v1/auth/signups/policy` → `passwordPolicy.minLength`). Imposing
no client-side minimum on login is the safe default, since the backend / Keycloak policy stays
authoritative and a policy-valid password can always be submitted.

> Note: the **signup** form (`apps/web-console/src/pages/SignupPage.tsx`) is a separate surface
> with its own password constraints; its length validation is tracked independently (#725) and is
> not governed by this login invariant.
