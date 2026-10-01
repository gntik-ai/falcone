## ADDED Requirements

### Requirement: Mongo bearer traffic is gateway authenticated and workspace bound

Bearer `/v1/mongo/*` traffic SHALL use route 2006 to reach the control plane executor. The gateway SHALL authenticate the token with signing keys from a configured Keycloak JWKS base, where the issuer is the configured issuer base followed by `/realms/` and a strictly validated realm name. The verifier SHALL never fetch an issuer outside that base, SHALL use a bounded cache, and SHALL reject malformed, expired, unsigned, invalid-signature, unknown-key, and foreign-issuer tokens with 401 before reaching an upstream. Failed JWKS fetches SHALL not evict successfully cached keys, and each gateway worker SHALL bound its JWKS fetch rate or concurrent fetches. Platform-realm tokens SHALL meet the configured audience; tenant-realm tokens SHALL be authenticated by their realm issuer. Newly created tenant realms SHALL require no route configuration change.

The gateway SHALL remove client identity headers and inject `x-gateway-auth` from the Secret-backed environment interpolation. The executor SHALL reject a token bound to workspace A when its request addresses workspace B. The API-key route 2006-key SHALL retain its existing scope and rate-limit behavior.

#### Scenario: Tenant bearer document request

Given a valid tenant-realm bearer token and a matching workspace path, when a client creates, lists, gets, updates, replaces, or deletes a Mongo document, then route 2006 reaches the executor handler.

#### Scenario: Untrusted bearer request

Given a missing, malformed, expired, foreign-issuer, or unverifiable token, when a client calls the Mongo API, then the gateway returns 401 and forwards no request.

#### Scenario: Unknown realms cannot flush trusted keys

Given successfully cached keys for a valid realm, when requests present tokens naming many unknown realms, then failed JWKS fetches do not evict the valid realm's keys and the worker bounds the resulting fetch load.

#### Scenario: Workspace mismatch

Given a valid token bound to workspace A, when a client addresses workspace B, then the executor returns 403.

### Requirement: Mongo gateway policy uses the realm JWKS verifier

The `public-api-mongo` product route SHALL require `issuer-jwks-auth` instead of `openid-connect`. Other product routes SHALL retain `openid-connect`. Existing `limit-count`, `client-control`, `request-validation`, `cors`, and `proxy-rewrite` requirements SHALL remain in force.

#### Scenario: Gateway policy validation

When the gateway policy contract validates route inventory, then it accepts the Mongo verifier only on `public-api-mongo` and rejects a Mongo route that restores `openid-connect` without the verifier.
