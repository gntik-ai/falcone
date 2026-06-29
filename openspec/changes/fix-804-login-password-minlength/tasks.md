# Tasks — fix-804-login-password-minlength

## 1. Reproduce
- [x] Confirm `apps/web-console/src/pages/LoginPage.tsx` login password `<Input>` carries
      `minLength={12}` while `/v1/auth/signups/policy` → `passwordPolicy.minLength` is 8.
- [x] Add a failing attribute-level test (RED on main): the login password field's effective
      client-side minimum exceeds the policy minimum (8).

## 2. Fix
- [x] Remove `minLength={12}` from the login password `<Input>`; keep `required` and
      `maxLength={256}`. Add a grounding comment (the backend policy is authoritative).

## 3. Tests
- [x] Attribute test: the login password field imposes no client-side minimum greater than the
      policy minimum (8).
- [x] Behavioral test: an 8-character policy-valid password (`Abcd1234`) submits and sends
      `POST /v1/auth/login-sessions`.
- [x] Do not weaken or delete any existing LoginPage test.

## 4. Scope / contract discipline
- [x] No change to `SignupPage.tsx` (its identical line is owned by #725).
- [x] No change to the `ConsoleSignupPolicy` type, any backend handler, or any
      OpenAPI/SDK/route-catalog/gateway artifact (codegen no-diff).

## 5. Docs
- [x] Document that the login form imposes no client-side password length floor (backend /
      Keycloak policy authoritative) in
      `docs/reference/architecture/console-login-password-validation.md`.
