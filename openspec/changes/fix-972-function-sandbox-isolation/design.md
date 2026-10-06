## Invocation trust boundary

Use Node's built-in Ed25519 signing and verification, with a `kid` identifying a public JWK in a
revision-local key ring. The control plane sends a Bearer JWT containing `aud`, target tenant and
workspace IDs, `iat`, `exp`, `jti`, verified caller context, and a SHA-256 hash of the request body.
The lifetime is 60 seconds. The runtime verifies algorithm, signature, audience, target ownership,
time window, body and caller shape before `resolveMain`. Caller context comes exclusively from the
verified claims. Legacy identity headers are sent during rollout but never trusted by new runtimes.

Public keys are injected as per-revision env rather than fetched from a JWKS endpoint, avoiding a new
function egress destination and network dependency. The runtime captures keys and target identity
before user code runs. Rotation requires publishing overlapping public keys and re-rolling existing
services before switching the signing key. Credentials are absent from function env and errors redact
the current credential. Missing signing configuration fails invocation without opening a socket;
missing verification configuration denies POSTs while keeping health probes available.

The control plane supports a read-only optional signer Secret directory through
`FN_INVOCATION_SECRET_DIR`. Deploy/re-roll reads only `jwks`; invocation reads `private-key`,
`key-id` and `jwks` lazily from one resolved kubelet projection. This recovers from late ESO
reconciliation without restarting and picks up atomic rotations. A configured mount takes
precedence over legacy env and fails closed when unavailable. The companion chart must wire the
entire directory only into the control-plane container without `subPath` and test install/upgrade
ordering; optional secretKeyRef env alone cannot update a container that started before reconciliation.

The separate control-plane-executor does not sign Knative invocations. Its default local worker
backend executes tenant function source in-process without a security sandbox, so tenant code can
read its filesystem. It must receive neither the signer Secret mount nor private signing env;
otherwise a tenant could steal the key and forge credentials for another ksvc. Chart delivery tests
must assert that signing material is absent from both executor and function workloads.

## Deployment boundary

Function pods carry `in-falcone.io/component: function`; naming and ownership labels stay stable.
The existing conflict/GET/ownership-check/resourceVersion/PATCH flow safely applies the new label and
public-key env to previously deployed functions. Workspace secret env cannot override reserved
verification configuration.

The companion chart change must use the MCP NetworkPolicy structure, including its ENFORCEMENT
CAVEAT comment, a default-enabled toggle, configurable Knative data-plane ingress namespaces and DNS
plus explicit egress. Its egress peers must never cover Kourier, Knative Serving or function pods.
No namespace-wide default-deny is introduced. Public internet and service access require explicit
operator allow-list configuration; no broad namespace allowance is implied by this source change.

Configuration, ordered rollout, rotation and required cluster evidence are documented in
[the operations guide](../../../../docs/installation/function-invocation-isolation.md).
