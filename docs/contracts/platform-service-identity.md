# Platform service identity contract

<!-- service-identity:metadata:start -->
| Field | Value |
| --- | --- |
| id | ctr-platform-service-identity |
| version | 1 |
<!-- service-identity:metadata:end -->

This is the binding service authentication and authorization policy for SEC-01,
including the OCI execution mode and base catalog amendment in ADR 0010.
It defines requirements for later consumers; it does not implement verification,
provision clients, or change deployment configuration.

All identifiers below are placeholders. An environment MUST bind the caller client
ids and each distinct callee audience through trusted configuration. The issuer
and realm allow-list MUST come from Falcone's realm policy; the example issuer is
not a deployable trust configuration. Never accept arbitrary realms or derive
trust from a presented token. Any later change to policy values or the permissions
table MUST bump the version and update the test in the same change. Before a
consumer pins v1, rollback is a revert; afterwards, supersede v1 with v2.

## Callers and callees

Each caller has its own Keycloak client id. No callee shares an audience, including
the OCI shim and both image services. A token is valid for exactly one callee.

<!-- service-identity:callers:start -->
| Caller | Placeholder Keycloak client id |
| --- | --- |
| controller | example-controller |
| dispatcher | example-dispatcher |
| build-orchestration | example-build-orchestration |
<!-- service-identity:callers:end -->

<!-- service-identity:audiences:start -->
| Callee | Audience |
| --- | --- |
| worker | urn:example:worker |
| compiler | urn:example:compiler |
| falcone-internal | urn:example:falcone-internal |
| oci-shim | urn:example:oci-shim |
| image-intake | urn:example:image-intake |
| image-assembler | urn:example:image-assembler |
<!-- service-identity:audiences:end -->

## Token verification

<!-- service-identity:signature:start -->
Every callee MUST verify the JWS signature against the allow-listed issuer JWKS before trusting any claim; unsigned or signature-invalid tokens MUST be rejected.
<!-- service-identity:signature:end -->

<!-- service-identity:token-policy:start -->
| Rule | Value |
| --- | --- |
| algorithms | RS256, ES256 |
| audience-shape | single string matching the receiving callee |
| max-lifetime-seconds | 300 |
| max-skew-seconds | 30 |
| required-claims | iss, aud, azp, exp, iat |
| issuer | `https://identity.example.invalid/realms/platform-example` |
| jwks-ttl-seconds | 600 |
| unknown-kid-refetch-seconds | 30 |
<!-- service-identity:token-policy:end -->

The algorithms apply to the protected JWS header. Reject `none`, symmetric
algorithms, missing or duplicated claims, malformed values, and unknown clients.
The `aud` claim MUST be one string equal to the receiving callee's audience;
arrays, multiple audiences and audiences shared across callees are forbidden.
The `azp` claim MUST identify the caller's listed client id and an allowed grant.
Require integer Unix seconds for `iat` and `exp`, with `exp > iat` and
`exp - iat <= 300`. At verification time `now`, require `iat <= now + 30`
and `exp > now - 30`. Skew never extends the token's issued lifetime bound.

<!-- service-identity:issuer:start -->
Issuer and realm MUST be explicitly allow-listed by the Falcone realm policy; wildcards, discovery from untrusted token URLs and implicit tenant-realm trust are forbidden.
<!-- service-identity:issuer:end -->

JWKS cache entries MUST expire within 600 seconds. The trusted issuer configuration
selects the JWKS endpoint. Token-controlled key URLs cannot establish trust.

<!-- service-identity:jwks:start -->
Unknown kid MUST fail closed, including after a refetch without a matching key; allow at most one unknown-kid refetch per issuer per 30 seconds. JWKS unreachable MUST fail closed.
<!-- service-identity:jwks:end -->

## Authorization and namespace binding

<!-- service-identity:authorization:start -->
Default deny: reject every caller, audience, operation or namespace binding not explicitly allowed below. No caller may create namespaces.
<!-- service-identity:authorization:end -->

<!-- service-identity:namespaces:start -->
Controller reads desired-state and demand and submits status and audit only in its bound preprovisioned namespaces. Dispatcher calls oci-shim only in its bound OCI namespaces. Bindings MUST be checked against trusted configuration, never token-supplied namespace claims.
<!-- service-identity:namespaces:end -->

Each row is one grant; no implied operations or transitive permissions exist.
`bound-preprovisioned` means the controller's explicit pre-existing namespace set.
`bound-execution` means the dispatcher's assigned worker execution namespaces;
`bound-oci` means its assigned OCI execution namespaces. `bound-build` means the
build orchestration's assigned build namespaces. These sets MUST be explicit and
nonempty for a request to succeed. None grants cluster scope, a wildcard namespace,
or namespace creation. These are namespace restrictions in addition to token
verification and operation authorization.

<!-- service-identity:permissions:start -->
| Caller | Audience | Operation | Namespace scope |
| --- | --- | --- | --- |
| controller | urn:example:falcone-internal | desired-state | bound-preprovisioned |
| controller | urn:example:falcone-internal | demand | bound-preprovisioned |
| controller | urn:example:falcone-internal | status | bound-preprovisioned |
| controller | urn:example:falcone-internal | audit | bound-preprovisioned |
| dispatcher | urn:example:worker | execute | bound-execution |
| dispatcher | urn:example:worker | cancel | bound-execution |
| dispatcher | urn:example:oci-shim | execute | bound-oci |
| dispatcher | urn:example:oci-shim | cancel | bound-oci |
| build-orchestration | urn:example:compiler | build | bound-build |
| build-orchestration | urn:example:compiler | validate | bound-build |
| build-orchestration | urn:example:image-intake | verify | bound-build |
| build-orchestration | urn:example:image-assembler | build | bound-build |
<!-- service-identity:permissions:end -->

## Credential custody

<!-- service-identity:custody:start -->
Client secrets MUST come from OpenBao via existing External Secrets, be referenced only by Secret name and a read-only mount path, and never be logged. No secret values belong in this contract.
<!-- service-identity:custody:end -->

A reference may identify placeholder Secret `example-service-client` and read-only
mount `/var/run/example-service-identity/client-secret`. This contract neither
specifies Secret values nor provisions Secrets or mounts.

<!-- service-identity:keys:start -->
Worker and compiler MUST hold public verification keys only. Apart from its per-pod identity, oci-shim MUST hold public verification keys only.
<!-- service-identity:keys:end -->

<!-- service-identity:shim:start -->
Dispatcher to oci-shim MUST use mutually authenticated TLS. The shim per-pod identity (certificate or projected token) MUST be mounted only in the shim container; dispatcher MUST verify it before sending any credential or request.
<!-- service-identity:shim:end -->

<!-- service-identity:tenant:start -->
The tenant container MUST hold no token or identity material.
<!-- service-identity:tenant:end -->

<!-- service-identity:storage:start -->
Image-intake and image-assembler MUST reach only the host storage API, using a build credential. Build credential issuance and execution credentials are outside this contract.
<!-- service-identity:storage:end -->

## Decoded example claim sets

These labelled blocks are illustrative decoded data, never bearer tokens or proof
of a valid signature. The `alg` field represents the protected JWS header rather
than a payload claim. The test verifies examples at fixed Unix time `1800000100`;
real consumers MUST use their current clock and verify signatures before claims.

### Dispatcher to worker

<!-- service-identity:claims-worker:start -->
```json
{
  "alg": "RS256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:worker",
  "azp": "example-dispatcher",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-worker:end -->

### Build orchestration to compiler

<!-- service-identity:claims-compiler:start -->
```json
{
  "alg": "ES256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:compiler",
  "azp": "example-build-orchestration",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-compiler:end -->

### Controller to Falcone internal APIs

<!-- service-identity:claims-falcone-internal:start -->
```json
{
  "alg": "RS256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:falcone-internal",
  "azp": "example-controller",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-falcone-internal:end -->

### Dispatcher to OCI shim

<!-- service-identity:claims-oci-shim:start -->
```json
{
  "alg": "ES256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:oci-shim",
  "azp": "example-dispatcher",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-oci-shim:end -->

### Build orchestration to image intake

<!-- service-identity:claims-image-intake:start -->
```json
{
  "alg": "RS256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:image-intake",
  "azp": "example-build-orchestration",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-image-intake:end -->

### Build orchestration to image assembler

<!-- service-identity:claims-image-assembler:start -->
```json
{
  "alg": "ES256",
  "iss": "https://identity.example.invalid/realms/platform-example",
  "aud": "urn:example:image-assembler",
  "azp": "example-build-orchestration",
  "iat": 1800000000,
  "exp": 1800000300
}
```
<!-- service-identity:claims-image-assembler:end -->
