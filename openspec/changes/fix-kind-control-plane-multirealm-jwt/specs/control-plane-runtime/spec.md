# control-plane-runtime — spec delta for fix-kind-control-plane-multirealm-jwt

## ADDED Requirements

### Requirement: The kind control-plane MUST verify per-tenant-realm tokens

The kind control-plane runtime (`deploy/kind/control-plane/server.mjs`) SHALL verify Bearer JWTs
issued by ANY per-tenant Keycloak realm under the trusted Keycloak base (derived from the configured
JWKS/issuer URL), not only the platform realm — at parity with the executor
(`apps/control-plane/src/runtime/jwt-verify.mjs`). It SHALL fetch each realm's JWKS on demand, and for
a tenant-realm token it SHALL derive the tenant id from the cryptographically-verified issuer (the
realm name), which cannot be forged by a `tenant_id` claim. Tokens whose issuer is outside the trusted
base SHALL be rejected. The verifier SHALL restrict the signing algorithm to RSA (rejecting `alg:none`
and HS* algorithm-confusion) and enforce exp/nbf, plus issuer and audience for the platform realm.

#### Scenario: Tenant owner reads their workspace via a control-plane route

- **WHEN** a `tenant_owner` presents a valid JWT issued by their tenant realm
  (`iss = <base>/realms/<tenantId>`) to a control-plane-served route (e.g. `GET /v1/workspaces/{id}`)
- **THEN** the control-plane verifies it against that realm's JWKS and authorizes by the verified
  tenant/roles (HTTP 200), the same way the executor already does — no `ERR_JWKS_NO_MATCHING_KEY`

#### Scenario: Tenant id comes from the verified issuer, not a forgeable claim

- **WHEN** a tenant-realm token carries a `tenant_id` claim that differs from its issuer's realm name
- **THEN** the derived tenant id is the realm name from the cryptographically-verified issuer, so a
  tenant-A token can never act as tenant B

#### Scenario: Issuer outside the trusted Keycloak base is rejected

- **WHEN** a token's issuer is not the platform realm and not a per-tenant realm under the trusted
  Keycloak base
- **THEN** verification fails and the request is rejected (401), even if the token is otherwise
  well-formed

#### Scenario: Platform/superadmin tokens are unaffected

- **WHEN** a platform-realm (e.g. superadmin) token is presented to a control-plane-served route
- **THEN** it is verified against the platform JWKS with issuer + audience enforced and authorized as
  before (no regression)
