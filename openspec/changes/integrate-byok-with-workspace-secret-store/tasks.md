## Implementation

- [x] Confirm assigned clean worktree and issue branch; retain immutable base 254a01d8e228fc5e3b8885c8e9ce25302b36ab64.
- [x] Reproduce env-only resolution using the public resolver with the real workspace store and fake KV.
- [x] Add exclusive workspace refs, shared name validation, scoped getValue, and bounded store errors.
- [x] Pass connection/batch identity into resolution without caching or mutating configuration.
- [x] Check existence before all LLM/embedding configuration writes.
- [x] Inject one store into both executor planes and package all shared module dependencies.
- [x] Preserve worker fail-closed behavior without env fallback or a worker OpenBao store.
- [x] Publish OpenAPI reference variants and regenerate related family/catalog documentation.
- [x] Add rotation, scope, configuration, batch, leak and worker tests; retain #659 tests unchanged.

## Verification and release gates

- [x] Run scoped regression suites, image import contracts, OpenAPI validation and strict OpenSpec validation.
- [ ] Independent verifier: Kind API secret create/rotate/completion, including pod identity stability.
- [ ] Independent verifier: confirm live executor BAO_ADDR and OpenBao role/policy read access.
- [ ] R3: human approval and review by both providers before release.

## Maker evidence

The initial command `node tests/blackbox/byok-workspace-secrets.test.mjs` failed at the public
resolver with null instead of the stored placeholder. A later vertical slice failed the real
completion path with LLM_PROVIDER_SECRET_UNRESOLVED before scope/store wiring. The confirmed cause
was env-only resolution plus missing verified tenant/workspace context at executor call sites.
The same tests now pass, including live rotation and batch snapshot resolution. Additional red/green
slices covered invalid refs, missing-secret config writes, embedding resolution and error hygiene.

The unchanged #659 suite and socket-free LLM/embedding registry, model, batch, ledger, vault token,
shared-store, worker/image and OpenAPI tests pass. The vault-workspace-secrets and legacy
llm-completion-routes suites cannot run here: listen EPERM on 127.0.0.1. Docker API access is also
permission denied at /var/run/docker.sock; image builds and Kind runtime verification remain in CI.
No release gate is bypassed.
