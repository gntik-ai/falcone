# Function invocation authentication and isolation

Function runtimes require a signed control-plane credential on every POST before evaluating
`FN_SRC`. Health/readiness GETs remain unauthenticated. Identity headers alone are insufficient.
A credential is bound to a ksvc, target tenant/workspace, verified caller and exact JSON body for
60 seconds. Signature, target, time or body failures return `401` without running user code.
Issuance time permits at most three seconds of node clock skew. Expiry has no leeway: a credential
is rejected at or after `exp`, and its declared lifetime still cannot exceed 60 seconds.
The existing public invocation API and activation recording remain the invocation path.

## Key delivery contract

The companion falcone-charts deployment must mount the ESO signer Secret only into the control-plane
container as a read-only optional Secret volume and set
`FN_INVOCATION_SECRET_DIR=/var/run/falcone/function-invocation`. Mount the entire directory; do not
use `subPath`, which prevents kubelet updates. The volume contains these Secret properties:

| Secret property | Delivery and meaning |
| --- | --- |
| `private-key` | Ed25519 PKCS#8 PEM from a control-plane-only Secret populated by External Secrets/OpenBao. Never inline in values or shared with functions. |
| `key-id` | Nonempty ID of the active signing key. |
| `jwks` | JSON object with `keys`, containing public Ed25519 JWKs with `kty`, `crv`, `x`, `kid`. Each `kid` is unique; private `d` fields are rejected. |

The control-plane function deployer copies only the public key ring to each function revision as
`FN_INVOCATION_JWKS`, with `FN_KSVC_NAME`, `FN_TENANT_ID` and `FN_WORKSPACE_ID`. Knative's `K_SERVICE`
is the authoritative audience when present. No signing implementation or private key is copied
into the runtime image.
The runtime captures this configuration at startup. Workspace-secret mappings cannot override
`FN_SRC`, `FN_KSVC_NAME`, `FN_TENANT_ID`, `FN_WORKSPACE_ID`, `FN_INVOCATION_JWKS`,
`FN_INVOCATION_PRIVATE_KEY`, `FN_INVOCATION_KEY_ID`, `FN_INVOCATION_SECRET_DIR`, `K_SERVICE`,
`NODE_OPTIONS` or `NODE_PATH`.

The separate `control-plane-executor` component does not sign Knative invocations and must receive
neither the signer Secret mount nor private signing env. Its default local worker backend runs
tenant function source in-process and is not a security sandbox: tenant code can read the pod's
filesystem. Giving that component the private key would let a tenant forge credentials for any
ksvc. The signer belongs only in the control-plane component that issues Knative invocations.

Create and PATCH requests using reserved secret env names return `400 VALIDATION_ERROR` before
secret resolution or workload mutation. Other `FN_*` names remain available: existing references
such as `fn-token` retain their default `FN_TOKEN` mapping on re-roll. A secret whose default name
is reserved needs an explicit safe mapping such as `{ "name": "fn-src", "env": "APP_SOURCE" }`,
with code updated to read that name. The manifest builder independently rejects reserved env names
with `400`.

The control plane reads the mount lazily on each deploy/re-roll or invocation, without caching
missing files or signing material. It resolves kubelet's `..data` symlink once per operation to read
one coherent Secret projection during rotation. The manifest builder reads only the public JWKS;
the signer reads all three properties. A configured mount is authoritative: missing or invalid
files fail closed even if legacy env contains valid keys. Without `FN_INVOCATION_SECRET_DIR`, the
three legacy `FN_INVOCATION_PRIVATE_KEY`, `FN_INVOCATION_KEY_ID` and `FN_INVOCATION_JWKS` env vars
remain supported for compatibility. Env-only delivery does not resolve late ESO reconciliation.

The companion chart must seed `platform/functions/invocation` idempotently through the existing
OpenBao bootstrap, preserving active and overlapping keys. Its ExternalSecret must retain the
signer Secret across upgrades (`creationPolicy: Orphan`, `deletionPolicy: Retain`). An optional
volume allows control-plane readiness before the post-install/post-upgrade ESO hook creates the
Secret; kubelet then projects it into the running container and the next function operation reads
it without a manual restart. Function operations return a fixed configuration error until that
projection exists; there is no unsigned fallback. The existing source CI ExternalSecret readiness
wait remains mandatory and does not replace install/upgrade tests.

The assigned companion deployment snapshot uses an optional read-only directory mount and has
fresh-install, first-upgrade and reuse-values render coverage. Before release, its maker must remove
the signer mount from `control-plane-executor`, update its delivery tests and operations guide, and
assert that only the control-plane container receives it. The mount must remain read-only and
optional, use no `subPath`, and be absent from executor and function workloads. A live upgrade must
prove an already-started control plane can invoke after ESO reconciliation and kubelet projection
without a restart. Source tests simulate this delayed delivery and atomic key rotation; they do not
prove Helm ordering or live kubelet behavior.

Signing configuration errors fail before the control plane opens an invocation socket and record a
failed activation. Missing or malformed runtime public-key/target configuration denies all POSTs
while allowing probes. Errors do not return parser diagnostics or raw unauthorized runtime bodies.
Runtime logs, result serialization and errors redact the current invocation credential.

## Initial rollout and existing functions

1. Provision the signing key through External Secrets/OpenBao, mount the optional signer volume,
   and configure `FN_INVOCATION_SECRET_DIR` in the control plane. Publish the signer before
   enforcing runtimes; the signer retains legacy identity headers so old runtimes can work
   during the coordinated rollout.
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

Release must remain gated until the companion chart mounts all three signer properties into
only the control plane through External Secrets/OpenBao and verifies late reconciliation without
a restart. A NetworkPolicy alone does not satisfy this gate: missing public keys stop
function deploys, and missing signing configuration returns `503` before invocation. Chart render
tests must cover safe defaults for `--reuse-values` upgrades and prove signing material is absent
from control-plane-executor and function workloads. Publish and pin the enforcing fn-runtime image
by immutable digest; the pre-change `0.3.0` runtime tag does not authenticate POSTs. Confirm an
authenticated cold start and exactly one activation after re-rolling existing functions before
clearing this release gate.

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

## Source follow-up validation limits

The root overrides and every locked version meet the reported patched floors: `source-map-js`
is `1.2.2`, and Vue/server-renderer are `3.5.43` (required floor `3.5.42`). No manifest or lockfile
changes are needed. This offline check does not replace the online audit.

The five scoped invocation-auth, lifecycle-ownership, cleanup-ownership, caller-context and signed
namespacing test files report 36 passing cases and three skipped HTTP cases when run directly under
30-second bounds. Invocation-auth reports 14 passing cases, including delayed Secret projection,
recovery without restart, rotation,
fail-closed mount precedence and fixed diagnostics for malformed material.
Three caller-context HTTP cases skip because the sandbox forbids localhost listeners;
request-listener tests verify runtime authentication without sockets.
The earlier follow-up's broader namespace-preservation harness exceeded its 30-second bound (exit `124`);
rerun it in PR CI. Shell syntax validation passes.

The matching security commands were attempted under 30-second bounds: `pnpm security:deps`
cannot run without corepack/network, `pnpm security:images` cannot run without npm, and both
`pnpm sbom:licenses` commands lack installed package indexes. Rerun the unchanged security job in
PR CI. Direct image-policy validation also cannot load the uninstalled `yaml` package.
HTTP socket cases, image builds/scans, companion chart render tests and live policy-enforcing
CNI acceptance remain CI/release checks. Keep every existing security and supply-chain gate.
