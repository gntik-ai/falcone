# Tasks: fix-725-console-signup-policy-tenant

## 1. Reproduce

- [x] Confirm the backend signup policy response is
      `{ selfServiceEnabled, mode, statusView, passwordPolicy, message }`.
- [x] Confirm `/signup` and `/login` read absent legacy policy fields and
      therefore treat enabled self-service signup as disabled.
- [x] Confirm the signup submit body omits `tenantId`, while the backend rejects
      missing tenant context with `400 VALIDATION_ERROR`.

## 2. Fix

- [x] Update the web-console auth types to match the runtime policy shape.
- [x] Update `/login` to show the signup entry point from `selfServiceEnabled`
      and preserve tenant/workspace URL context.
- [x] Update `/signup` to render from `selfServiceEnabled`, collect/preserve
      tenant context, submit `tenantId`, optionally submit `workspaceId`, and
      use `passwordPolicy.minLength` for the password field.
- [x] Keep backend runtime behavior unchanged; it already emits and enforces the
      required contract.

## 3. Wire / contract / docs

- [x] Update the root OpenAPI source for the runtime signup policy shape,
      `tenantId` request field, optional `workspaceId`, `201` signup response,
      and default password minimum.
- [x] Regenerate derived public API artifacts.
- [x] Document the console signup policy mapping and tenant context behavior.
- [x] Add an OpenSpec delta under the web-console capability.

## 4. Tests

- [x] Update `SignupPage` tests to use the runtime policy shape and assert the
      submit body carries `tenantId`.
- [x] Update `LoginPage` tests to show the signup CTA from `selfServiceEnabled`
      and preserve tenant/workspace query context.
- [x] Update console auth E2E mocks to use the runtime policy shape and reject
      signup posts that omit tenant context.
- [x] Run focused web-console tests.
- [x] Run OpenAPI/contract/codegen checks.
- [x] Run OpenSpec validation.
