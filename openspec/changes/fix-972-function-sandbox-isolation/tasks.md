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

## Companion deployment repository and release gates

- [x] Seed control-plane-only signing material in OpenBao idempotently on fresh install and upgrade, preserving existing keys.
- [ ] Preserve the ESO signer Secret across managed-ESO Helm upgrades and prove the lifecycle with a render test, without a Helm readiness deadlock.
- [x] Wire all three invocation env vars in the control-plane chart, with reuse-values-safe defaults and render tests excluding signing material from function workloads.
- [x] Add default-enabled function ingress/egress NetworkPolicy and configurable allow-list.
- [x] Prove selectors against rendered/fixture function pods in every shipped values profile.
- [ ] Run HTTP blackbox tests, image builds/scans and chart validation in PR CI.
- [ ] Publish the enforcing fn-runtime image and pin its immutable digest; the pre-change 0.3.0 tag is insufficient.
- [ ] Re-roll existing functions after signer configuration and before retiring verification keys.
- [ ] On a policy-enforcing CNI, deny B-to-A cluster-local calls with A activations unchanged at zero.
- [ ] Prove cold-start invocation through the public API succeeds with exactly one activation.
- [ ] Independently verify the ChangeSet before release; kindnet alone is insufficient evidence.

Completed chart seeding, wiring, policy and selector tasks reflect the supplied independent
checker evidence for falcone-charts commit `c1bad265f62236cc24d20c418d40875c729c9e51`
(passing bootstrap and secret-delivery tests, selector tests, reuse-values render and Helm lint).
OpenBao now seeds the absent signer record and preserves existing signing material. The remaining
blocking deployment finding is the managed-ESO ExternalSecret's hook lifecycle: Helm recreates
the hook on upgrade, and `creationPolicy: Owner` lets garbage collection delete the signer Secret.
Optional env references can then leave a starting control-plane pod without signing configuration
until restarted. The companion chart must preserve the Secret across upgrades and add a render
test for the chosen lifecycle. The source CI ExternalSecret readiness wait remains mandatory;
this source follow-up reconciles the documentation and does not claim the deployment fix or
cluster acceptance.

Current source follow-up validation: the invocation-auth, lifecycle-ownership, cleanup-ownership,
caller-context and signed namespacing test files pass under a 60-second bound. This follow-up
changes only the task record and operations guide; no dependency or workflow pin changes are
needed. Image builds/scans, the full phased-install namespace suite, the service-catalog validator
(missing installed dependencies) and policy-enforcing cluster acceptance remain PR CI/release
checks. Companion chart lifecycle validation remains the deployment maker's responsibility.
