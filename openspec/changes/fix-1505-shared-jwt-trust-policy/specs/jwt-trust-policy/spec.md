# JWT trust policy

## ADDED Requirements

### Requirement: Shared verifier decisions

Both existing verifier APIs SHALL apply the same issuer, signature, RSA algorithm, expiry/nbf, platform/tenant audience and revocation policy when given the same configuration. API return shapes and legacy bare-JWKS behavior SHALL remain compatible.

#### Scenario: Existing platform console session

- GIVEN a token signed by the configured platform realm key, without `tenant_id`, with `aud: account`
- AND both the public and internal realm bases and `account` rollout audience are explicitly configured
- WHEN either verifier authenticates either exact platform issuer
- THEN verification succeeds and the executor's existing platform workspace substitution permits flows and MCP list routes for the requested workspace owner.

#### Scenario: Strict rollout policy

- GIVEN the explicit platform audience array contains only `in-falcone`
- WHEN a token carries only `account` or only a matching `azp`
- THEN both verifiers reject it for audience mismatch.

### Requirement: Exact trust boundaries

Foreign issuer hosts, incorrect realm paths, trailing segments, unallowlisted aliases and unsafe realm segments SHALL be rejected before any JWKS request. Platform aliases SHALL use the same configured platform JWKS. Tenant JWKS SHALL be fetched only under an allowlisted base. Verified tenant realm identity SHALL override tenant claims and SHALL NOT address a different tenant's workspace.

#### Scenario: Tenant and signing failures

- GIVEN tenant audience enforcement is enabled
- WHEN a token has a mismatched tenant audience, expired lifetime, future nbf, bad signature, unsupported alg, unknown kid or revoked service-account credential
- THEN both verifiers reject it with the same failure category.

### Requirement: Safe and distinct JWT failures

A JWT verification failure SHALL produce `401 INVALID_TOKEN` in the executor. Non-JWT missing/invalid credentials SHALL retain the existing missing-identity error. API-key, SSE query API-key and gateway-header identity behavior SHALL remain unchanged. Each shared verifier failure SHALL log only a bounded category, issuer host and audience list, never token segments, signatures or full claims.

#### Scenario: Revoked service-account JWT

- GIVEN a correctly signed service-account JWT whose credential has been revoked
- WHEN the executor authenticates a request using that token
- THEN the response is HTTP 401 with code `INVALID_TOKEN`
- AND the verification log contains only category `revoked`, the issuer host and bounded audience values, without token segments, signatures or full claims.

#### Scenario: Missing or invalid opaque credential

- GIVEN a request with no credential or an invalid non-JWT credential
- WHEN the executor authenticates the request
- THEN the response retains HTTP 401 with code `UNAUTHENTICATED` and message `Missing tenant identity`.
