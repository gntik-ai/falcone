## Source repository

- [x] Add control-plane Ed25519 signing and runtime verification before source evaluation.
- [x] Preserve verified caller context and reject missing, forged, expired and wrong-target credentials.
- [x] Label function pod templates and inject public-only key rings and target identity.
- [x] Preserve ownership checks and document idempotent PATCH re-rolls and key overlap rotation.
- [x] Add scoped signer/verifier, runtime listener, manifest, lifecycle and naming tests.
- [x] Allow three seconds of issuance-time clock skew without extending expiry or credential lifetime.
- [x] Return a clear 400 for reserved workspace-secret env mappings and document existing-function migration.
- [x] Reserve only runtime, invocation and Node configuration names; preserve unrelated FN_* secret mappings.
- [x] Apply the function signer ExternalSecret in phased CI through the existing OpenBao/ESO readiness gates.
- [x] Use the test runner's Node binary in the isolated e2e harness, including installations outside /usr/bin.
- [x] Read an optional signer Secret directory lazily, pin atomic projections and recover after late ESO reconciliation without restart.
- [x] Test delayed projection, rotation, public-only manifests and fail-closed mount precedence.
- [x] Require patched source-map-js and Vue/server-renderer versions and verify the platform-regenerated lockfile offline.
- [x] Correct source docs and spec to exclude control-plane-executor from signer delivery and record the companion security fix as a release gate.

## Companion deployment repository and release gates

- [x] Seed control-plane-only signing material in OpenBao idempotently on fresh install and upgrade, preserving existing keys.
- [x] Define an ESO signer Secret lifecycle that survives managed-ESO hook replacement and add an upgrade render test; rerun the test in companion PR CI.
- [x] Replace env-only signer delivery with a read-only optional Secret directory mount; render-test fresh install, first upgrade and reuse-values, with no subPath or function mount.
- [ ] Restrict the signer mount and private signing env to control-plane only; remove delivery to control-plane-executor and update companion delivery tests and operations guide to assert executor exclusion.
- [x] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [x] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Publish the enforcing fn-runtime image and pin its immutable digest; the pre-change 0.3.0 tag is insufficient.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.

The assigned companion chart now mounts an optional read-only signer Secret directory. Source
supports `FN_INVOCATION_SECRET_DIR`, reading the projected Secret lazily and recovering without
restart once the volume is populated. The chart still mounts the private key into
control-plane-executor, which never signs Knative invocations and runs tenant source in-process
through its default local worker backend. The deployment maker must remove that mount and private
signing env from the executor and update its tests and operations guide to enforce control-plane-only
delivery. This source-only follow-up corrects the contract; the deployment security fix and live
late-reconciliation evidence remain required.

The 2026-10-07 follow-up review of source HEAD `eeec68bcca6f86cb0ef63127aeb3c2206b847a5b`
reports 52 passing cases, including all 14 invocation-auth cases and
the mutation-authorization, Knative-availability and invocation-input-binding regressions. Three
HTTP cases skip because localhost listeners are prohibited. Offline manifest/lockfile checks
confirm that every source-map-js and Vue/server-renderer entry meets the reported patched floors;
the security log reports vulnerable versions absent from the assigned snapshot. No further
dependency changes are required. The four matching security commands cannot complete without
corepack, npm, network and installed package indexes. Rerun them unchanged in PR CI.
Five source-build Dockerfile cases also pass; its service-catalog case exits with a failure because
the existing `yaml` dependency is not installed. Direct image-policy validation has the same limit.
Rerun both after CI installs the frozen lockfile; no dependency or safety-gate changes are required.
The namespace-preservation harness again exceeded its 30-second bound with exit 124 and no case
output; rerun it in CI. Shell syntax validation passes. Image publication, HTTP tests, re-rolls, live upgrade,
policy-enforcing CNI acceptance and independent verification remain release gates.
