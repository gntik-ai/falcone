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

## Companion deployment repository and release gates

- [x] Seed control-plane-only signing material in OpenBao idempotently on fresh install and upgrade, preserving existing keys.
- [x] Define an ESO signer Secret lifecycle that survives managed-ESO hook replacement and add an upgrade render test; rerun the test in companion PR CI.
- [ ] Replace env-only signer delivery with a read-only optional Secret directory mount in both signer consumers; render-test fresh install, first upgrade and reuse-values, with no subPath or function mount.
- [x] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [x] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Publish the enforcing fn-runtime image and pin its immutable digest; the pre-change 0.3.0 tag is insufficient.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.

The assigned companion chart still injects optional signer env references. ESO's
post-install/post-upgrade reconciliation cannot update env in already-started containers. Source
now supports `FN_INVOCATION_SECRET_DIR`, reading the projected Secret lazily and recovering without
restart once the volume is populated. The deployment maker must wire that directory mount and
prove its ordering; the source-only follow-up does not close this deployment task.

Scoped source tests pass, including all 14 direct invocation-auth cases. Offline manifest/lockfile
checks confirm the already-resolved source-map-js and Vue/server-renderer security fixes. The four
matching security commands cannot complete without corepack, npm, network and installed package
indexes; rerun them unchanged in PR CI. The broader namespace-preservation harness exceeded its
30-second bound; rerun it in CI. Shell syntax validation passes. Image publication, HTTP tests, re-rolls, live upgrade,
policy-enforcing CNI acceptance and independent verification remain release gates.
