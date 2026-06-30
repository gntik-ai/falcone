# Change: fix-725-console-signup-policy-tenant

## Why

Issue #725 is a confirmed web-console signup break. The control-plane runtime
advertises self-service signup with `GET /v1/auth/signups/policy` returning
`selfServiceEnabled: true`, but the console reads absent legacy fields
(`allowed`, `effectiveMode`, `approvalRequired`, `reason`). As a result, `/signup`
renders signup as disabled and `/login` hides the signup entry point.

A second wire gap prevents direct form submission: `POST /v1/auth/signups`
requires `tenantId` because signup creates the user in an existing tenant realm,
but the console request body omits tenant context.

## What Changes

- `apps/web-console/src/lib/console-auth.ts`
  - Aligns `ConsoleSignupPolicy` with the runtime policy shape:
    `selfServiceEnabled`, `mode`, `statusView`, `passwordPolicy.minLength`, and
    `message`.
  - Adds required `tenantId` and optional `workspaceId` to
    `ConsoleSignupRequest`.
- `apps/web-console/src/pages/LoginPage.tsx`
  - Shows the signup entry point when `selfServiceEnabled` is true.
  - Preserves tenant/workspace query context when linking from `/login` to
    `/signup`.
- `apps/web-console/src/pages/SignupPage.tsx`
  - Renders the form from `selfServiceEnabled`.
  - Prefills tenant/workspace context from `?tenantId=`, `?tenant=`, and
    `?workspaceId=`.
  - Provides explicit tenant/workspace fields, requires tenant context before
    submit, and sends `tenantId` in the signup body.
  - Uses `passwordPolicy.minLength` for the signup password field.
- `apps/control-plane/openapi/control-plane.openapi.json`
  - Updates the public contract to match the runtime policy response, the
    `201` signup response, the required signup `tenantId`, optional
    `workspaceId`, and the default password minimum of 8.
  - Regenerates the auth family OpenAPI artifact.
- Focused web-console tests now use the runtime policy shape and assert the
  signup request includes tenant context.

## Scope

This is a frontend and public-contract wire fix. The backend handler already
emits the policy shape and requires tenant context, so no runtime backend logic
changes are needed.

No cluster deploy was performed in this run because the active kube-context is
not the designated local `kind-*` test environment.
