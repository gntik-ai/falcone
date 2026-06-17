# fix-tenant-realm-token-issuance

## Change type
bug-fix

## Capability
tenant-rbac (cap-iam-admin)

## Priority
P1

## Why (Problem Statement)
Tenant users are placed in a per-tenant Keycloak realm but:
(a) The tenant realm receives no Keycloak client and no `tenant_id` protocol mapper
    at creation time — so tokens from the tenant realm carry no `tenant_id` claim.
(b) The executor verifies JWTs only against the **platform realm JWKS** — tokens
    issued by a tenant realm are rejected with `Missing tenant identity`.

Net effect: tenant owners and users cannot authenticate to the data-plane or console
via the documented flows.

**Evidence (live campaign 2026-06-17):**
- Tenant-realm ROPC token → executor: 401 `Missing tenant identity` even with
  `tenant_id` attribute set on the user.
- Finding A3 in the campaign report.

## What Changes
1. At tenant creation, provision a per-tenant Keycloak app client in the tenant realm
   and add a `tenant_id` protocol mapper that injects the tenant's ID into tokens.
2. Make the executor's JWKS verification accept tenant-realm issuers (multi-realm
   JWKS cache) or define and implement the intended token path (e.g. token exchange
   from tenant realm → platform realm).

## Impact
- **Functional:** unblocks all tenant-user flows (data-plane access, key issuance,
  console login for non-superadmin users).
- **Security:** the fix must preserve tenant isolation — tokens from tenant-A realm
  MUST NOT be accepted for tenant-B resources.
- **Dependencies:** D.1 (`fix-platform-client-default-scopes`) for the platform realm
  to be functional; D.3 for `tenant_id` attribute to be preserved.
