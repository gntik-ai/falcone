# Function invocation authentication and isolation

Function runtimes require a signed control-plane credential on every POST before evaluating
`FN_SRC`. Health/readiness GETs remain unauthenticated. Identity headers alone are insufficient.
A credential is bound to a ksvc, target tenant/workspace, verified caller and exact JSON body for
60 seconds. Signature, target, time or body failures return `401` without running user code.
Issuance time permits at most three seconds of node clock skew. Expiry has no leeway: a credential
is rejected at or after `exp`, and its declared lifetime still cannot exceed 60 seconds.
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
`FN_SRC`, `FN_KSVC_NAME`, `FN_TENANT_ID`, `FN_WORKSPACE_ID`, `FN_INVOCATION_JWKS`,
`FN_INVOCATION_PRIVATE_KEY`, `FN_INVOCATION_KEY_ID`, `K_SERVICE`, `NODE_OPTIONS` or `NODE_PATH`.

Create and PATCH requests using reserved secret env names return `400 VALIDATION_ERROR` before
secret resolution or workload mutation. Other `FN_*` names remain available: existing references
such as `fn-token` retain their default `FN_TOKEN` mapping on re-roll. A secret whose default name
is reserved needs an explicit safe mapping such as `{ "name": "fn-src", "env": "APP_SOURCE" }`,
with code updated to read that name. The manifest builder independently rejects reserved env names
with `400`.

Key delivery must also converge on fresh installs and upgrades without manual provisioning. The
companion chart must seed `platform/functions/invocation` idempotently through its existing
OpenBao bootstrap and preserve existing signing keys. Required Secret references cannot depend
on a Secret created only by a post-install hook after Helm's workload readiness wait. Use the
existing precreated Secret/ESO Merge lifecycle, or optional references that allow the control
plane to start while function operations remain fail-closed. The source phased CI install applies
`platform-function-invocation` alongside the other chart ExternalSecrets after OpenBao and the
store are ready, and waits for ESO reconciliation before subsequent bootstrap and rollout gates.
That reconciliation still requires the companion chart to provision the OpenBao record.

The supplied independent checker evidence for falcone-charts commit
`c1bad265f62236cc24d20c418d40875c729c9e51` confirms idempotent signer seeding and passing bootstrap
and secret-delivery tests. When the record is absent, the OpenBao bootstrap generates an Ed25519
PKCS#8 private key, a nonempty key ID and a matching public-only JWKS, stored together under
`secret/platform/functions/invocation` with properties `private-key`, `key-id` and `jwks`.
Re-running bootstrap on install or upgrade preserves the existing record, including the active
signing key and overlapping verification keys. Keep generation inside the OpenBao bootstrap;
do not generate keys in source CI, inline them in Helm values, log them or fall back to unsigned
invocations.

The pinned companion chart at `7c9b5f276fe2ed7ced1e6f06eb37fe18d82f5c62` uses
`creationPolicy: Orphan` with `deletionPolicy: Retain` in
`charts/in-falcone/charts/eso/templates/external-secrets/platform-function-invocation.yaml`.
ESO therefore creates the target without an owner reference, so replacing the managed-ESO hook
on upgrade does not garbage-collect the signer Secret. `deletionPolicy: Retain` alone would not
protect a target created with `creationPolicy: Owner`. The companion
`tests/function-invocation-secret-delivery.test.mjs` includes a managed-ESO upgrade render test
asserting the Orphan lifecycle. This source review confirms the template and test contents; PR CI
must run that test, and live upgrade validation remains required. The phased CI install must still
stop at its existing ExternalSecret readiness wait on reconciliation failure. A fresh control-plane
pod starting before initial signer reconciliation can receive no signing env through the optional
references and fail invocations with `503` until restarted. Keep ESO readiness before rollout;
static lifecycle review does not establish live cluster acceptance.

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

Release must remain gated until the companion chart delivers all three invocation variables to
the control-plane container, with the private key and active key ID supplied through External
Secrets/OpenBao. A NetworkPolicy alone does not satisfy this gate: missing public keys stop
function deploys, and missing signing configuration returns `503` before invocation. Chart render
tests must cover safe defaults for `--reuse-values` upgrades and prove signing material is absent
from function workloads. Publish and pin the enforcing fn-runtime image by immutable digest;
the pre-change `0.3.0` runtime tag does not authenticate POSTs. Confirm an authenticated cold start
and exactly one activation after re-rolling existing functions before clearing this release gate.

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

The review of dependency-resolution commit `f7451be8e3db50a800f0a05ce41ed22cf2428ebb`
confirms the reported security fixes: the root overrides require `source-map-js` at least `1.2.2`
and `vue` / `@vue/server-renderer` at least `3.5.42`. Offline assertions checked matching lockfile
overrides and every locked version of these packages: `source-map-js` resolves to `1.2.2`, and
Vue/server-renderer resolve to `3.5.43`. The platform regenerated the lockfile; no further dependency
or audit-exception changes are needed. This confirms the reported version floors, not the result
of an online vulnerability audit.

The invocation-auth, lifecycle-ownership, cleanup-ownership, caller-context and signed namespacing
test files pass under a 30-second bound. All 12 invocation-auth cases pass, including rejection
before source evaluation, verified identity, public-only env, expiry, rotation, credential
redaction and one activation after readiness. The namespace-preservation harness also passed.
Three caller-context HTTP cases skip because the sandbox forbids localhost listeners; request
listener tests exercise runtime authentication without sockets. Shell syntax validation passes.

Required CI checks retain these local limits:

- `pnpm security:deps` needs network access to the vulnerability registry and the unavailable
  `corepack` command; rerun the unchanged security job in PR CI.
- `pnpm security:images` cannot launch its existing `npm` command because `npm` is absent.
- `pnpm sbom:licenses` cannot produce a report without installed dependency package indexes.
- `pnpm test:unit` was attempted and returned 100 failing test files and 86 passing files; missing
  workspace dependencies include `yaml`, `cel-js`, `ajv`, `kafkajs` and `undici`. The
  `source-build-root-context.test.mjs` service-catalog case likewise fails for missing `yaml`;
  its five Dockerfile contract cases pass. Rerun both complete commands after installation.
- `node scripts/validate-structure.mjs` requires the companion charts checkout at the expected
  sibling path, which is absent in this sandbox layout.
- Image builds/scans and policy-enforcing cluster acceptance need the CI/release environment.

Keep the existing security, supply-chain and release gates intact. Image publication, re-rolls,
enforcing-CNI evidence and independent verification remain release requirements.
