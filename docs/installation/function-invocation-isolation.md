# Function invocation authentication and isolation

Function runtimes require a signed control-plane credential on every POST before evaluating
`FN_SRC`. Health/readiness GETs remain unauthenticated. Identity headers alone are insufficient.
A credential is bound to a ksvc, target tenant/workspace, verified caller and exact JSON body for
60 seconds. Signature, target, time or body failures return `401` without running user code.
The existing public invocation API and activation recording remain the invocation path.

## Key delivery contract

The companion falcone-charts deployment must configure these control-plane env vars:

| Variable | Delivery and meaning |
| --- | --- |
| `FN_INVOCATION_PRIVATE_KEY` | Ed25519 PKCS#8 PEM from a control-plane-only Secret populated by External Secrets/OpenBao. Never inline in values or shared with functions. |
| `FN_INVOCATION_KEY_ID` | Nonempty ID of the active signing key. |
| `FN_INVOCATION_JWKS` | JSON object with `keys`, containing public Ed25519 JWKs with `kty`, `crv`, `x`, `kid`. Each `kid` is unique; private `d` fields are rejected. |

The executor copies only the public key ring to each function revision as `FN_INVOCATION_JWKS`,
with `FN_KSVC_NAME`, `FN_TENANT_ID` and `FN_WORKSPACE_ID`. Knative's `K_SERVICE` is the authoritative
audience when present. No signing implementation or private key is copied into the runtime image.
The runtime captures this configuration at startup. Workspace-secret mappings cannot override
`FN_*`, `K_SERVICE`, `NODE_OPTIONS` or `NODE_PATH`.

Signing configuration errors fail before the control plane opens an invocation socket and record a
failed activation. Missing or malformed runtime public-key/target configuration denies all POSTs
while allowing probes. Errors do not return parser diagnostics or raw unauthorized runtime bodies.
Runtime logs, result serialization and errors redact the current invocation credential.

## Initial rollout and existing functions

1. Provision the signing key through External Secrets/OpenBao and configure its public key ring
   and active `kid` in the control plane. Publish the signer before enforcing runtimes; the signer
   retains legacy identity headers so old runtimes can work during the coordinated rollout.
2. Set the control plane's runtime image to the new image through the deployment repository's
   existing immutable-image process. Confirm signing configuration before re-rolling workloads.
3. For each owned function, use the existing `PATCH /v1/functions/actions/{id}` flow with its same
   `source.inlineCode`, execution limits and declared secret references. This preserves the
   deterministic ksvc name, function resource identity and workload configuration. The executor's
   conflict/GET/ownership-label checks and resourceVersion-guarded PATCH apply the component label
   and public-key env. Repeating the same definition is idempotent at the ksvc manifest level.
   A mismatched owner fails closed; do not bypass this check to adopt old unlabeled resources.
4. Verify the new revision before completing rollout. Existing revisions do not gain env or pod
   labels until patched/redeployed. Runtime enforcement has no enabled-off default or bypass flag.

## Rotation

1. Add the next public JWK under a new `kid` alongside the current key in the control-plane ring.
2. Re-apply all existing functions through the ownership-checked PATCH flow. Wait until running
   revisions have both public keys before switching the control-plane private key and active `kid`.
3. Verify legitimate cold-start invocations with the new signer. Keep the old public key until
   outstanding credentials have expired and old revisions/rollback candidates are no longer used.
4. Remove the old public key and re-apply functions again. Application rollback re-deploys source
   using the current public-key ring; direct rollback to an old Kubernetes revision can omit keys.

Credentials are bearer capabilities during their short validity window. `jti` gives each invocation
an ID; this change rejects replay at/after expiry and binds the body, without adding a persistent
single-use replay store. Public-key env avoids requiring function egress to a JWKS endpoint.

## Companion NetworkPolicy and acceptance evidence

The chart's default-enabled function policy must select `in-falcone.io/component: function`, allow
Ingress only from configured Knative data-plane namespaces, and restrict Egress to DNS plus an
explicit values-configurable allow-list. Egress must not cover `kourier-system`, `knative-serving`,
or function pods, even indirectly through a broad namespace selector. Workspace data services and
public internet access require operator-selected destinations; there is no broad default grant.
The policy toggle removes this policy for rollback; it does not disable runtime authentication.

The deployment maker must implement and validate the policy in falcone-charts. Run
`networkpolicy-selector-reality.test.mjs` with a matching function pod fixture in every shipped
profile and prove default-on/toggle-off behavior. Source tests establish cryptographic rejection,
source-evaluation ordering, caller context, ownership-safe PATCH and activation wiring. HTTP
blackbox tests need a sandbox permitting local sockets; image builds and scans run in PR CI.

Before release on a policy-enforcing CNI, repeat the tenant-B-to-A cluster-local attack and prove a
connection refusal/timeout with A's activations unchanged at zero. A direct unauthenticated POST to
one's own ksvc must return `401` or be network-blocked. A legitimate public-API cold-start invocation
must succeed and write exactly one activation. Kindnet does not enforce NetworkPolicy and cannot
supply this network-isolation evidence. No cluster acceptance is claimed by this source ChangeSet.
