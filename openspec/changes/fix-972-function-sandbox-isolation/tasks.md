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
- [x] Correct the signer KV path and document effective OpenBao policy isolation for executor and workflow-worker service accounts.

## Companion deployment repository and release gates

- [x] Seed signing material in OpenBao idempotently on fresh install and upgrade, preserving existing keys; dedicated-path policy isolation remains gated below.
- [x] Define an ESO signer Secret lifecycle that survives managed-ESO hook replacement and add an upgrade render test; rerun the test in companion PR CI.
- [x] Replace env-only signer delivery with a read-only optional Secret directory mount; render-test fresh install, first upgrade and reuse-values, with no subPath or function mount.
- [x] Restrict the signer mount and private signing env to control-plane only; remove delivery to control-plane-executor and update companion delivery tests and operations guide to assert executor exclusion.
- [ ] Move the signer KV record to `secret/control-plane/function-invocation`, outside `platform/*`; update remoteKey validation, schema, seeding and ExternalSecret references, and grant read only through a dedicated ESO policy, with writes limited to the init/seed role.
- [ ] Prove that no OpenBao policy bound to executor or workflow-worker service accounts covers the dedicated signer path, while ESO can read it.
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
restart once the volume is populated. The independent checker confirmed that the reviewed chart
restricts the signer mount to control-plane. However, the signer remains under
`secret/platform/functions/invocation`, readable through the platform policy bound to executor and
workflow-worker service accounts. The executor's local worker backend runs tenant source in-process,
so tenant code can use its service-account token to retrieve the key from OpenBao. The deployment
maker must move the record outside `platform/*` to `secret/control-plane/function-invocation` and
restrict effective policy access to ESO and init/seed roles. This source-only follow-up corrects the
contract and stale mount finding; the companion policy fix and live late-reconciliation evidence
remain release gates. No deployment files are changed by this source follow-up.

This follow-up started from assigned source HEAD `873a23505dcc151493fdcb071d2189e65a2bf7e7`
and reviewed companion HEAD `de94b6c69162cdfd5a0403eb229de38374720a1d` read-only. All eight
scoped source function test files completed without added timeout wrappers: 52 cases passed and
three caller-context HTTP cases skipped because localhost listeners are forbidden. Authentication,
source-evaluation ordering, caller identity, public-only manifests, rotation, ownership-checked
PATCH and single-activation wiring remain covered. The source code and dependency manifests need
no further change. Image builds/scans, live ESO reconciliation, policy-enforcing CNI isolation and
cold-start activation acceptance remain PR CI/release checks. The deployment maker must also review
the seed Job's stale-marker retry edge case and obtain product/operations confirmation of the
DNS-only default egress before release.

The 2026-10-07 follow-up review of source HEAD `db370ca552ca824b39d6a834ff71a0af907b511b`
reports 52 passing cases, including all 14 invocation-auth cases and
the mutation-authorization, Knative-availability and invocation-input-binding regressions. Three
HTTP cases skip because localhost listeners are prohibited. Offline manifest/lockfile checks
confirm that every source-map-js and Vue/server-renderer entry meets the reported patched floors;
the security log reports vulnerable versions absent from the assigned snapshot. No further
dependency changes are required. The four matching security commands cannot complete without
corepack, npm, network and installed package indexes. Rerun them unchanged in PR CI.
Earlier validation at `aa52d7e9d4b75aff768ab3e11c22d5b3a998b1c7` recorded five passing
source-build Dockerfile cases; its service-catalog case exited with a failure because
the existing `yaml` dependency is not installed. Direct image-policy validation has the same limit.
Rerun both after CI installs the frozen lockfile; no dependency or safety-gate changes are required.
That earlier complete namespace-preservation harness passed all 57 cases in approximately 94 seconds
without an added timeout wrapper, including signer reconciliation through ESO readiness gates.
This supersedes the previous 30-second interruption, which was not a test failure. All scoped
tests ran without added timeout wrappers. Shell syntax validation passes. Image publication,
HTTP tests, re-rolls, live upgrade, policy-enforcing CNI acceptance and independent verification
remain release gates. This documentation-only follow-up reran the eight scoped function test files,
offline patched-floor checks and shell syntax validation; it did not rerun the unchanged Dockerfile
or namespace-preservation harness files. No further source or dependency change was identified.
