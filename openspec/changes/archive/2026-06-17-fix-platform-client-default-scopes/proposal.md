# fix-platform-client-default-scopes

## Change type
bug-fix

## Capability
tenant-rbac (cap-token-validation / cap-auth-console)

## Priority
P1

## Why (Problem Statement)
The `in-falcone-console` and `in-falcone-gateway` Keycloak clients are created by the
bootstrap Job without the standard `roles`, `basic`, and `profile` default client
scopes. As a result, issued tokens contain only the `openid` scope — no
`realm_access.roles` claim — and every role-based authorization check returns 403,
including for the superadmin role.

**Evidence (live campaign 2026-06-17):**
- Token claims: `{ scope: "openid" }` — no roles.
- After manually adding `roles` scope: `superadmin` appears in token → 403 became 201.
- Finding A2 in the campaign report.

## What Changes
Include the standard Keycloak default client scopes (`roles`, `basic`, `profile`)
alongside the custom context scopes in both client payloads sent by the bootstrap Job.

## Impact
- **Security:** without this fix every role-based authorization is broken by default.
- **Breaking change:** none (adds scopes to newly created clients; existing deployments
  can be patched by re-running the scope assignment step).
- **Dependencies:** pairs with D.4 (`fix-superadmin-created-disabled`) for a fully
  functional fresh install.
