## Implementation

- [x] Verify the clean assigned branch
      agent/falcone/973/1771ef68-1178-564a-a854-8c4727b15986 at immutable source base
      0575fa0dd0cb8a7130ee6627cfc0942ad351754b.
- [x] Reproduce the unbound tenant_viewer GET twice before editing source:
      node --test --experimental-test-isolation=none
      tests/blackbox/storage-workspace-authz.test.mjs.
      The public handler returned 200 instead of 404. Confirmed cause: the bucket
      gate compared tenant_id only, ignoring the verified workspace binding.
- [x] Introduce the shared read gate and observe the GET regression pass.
- [x] Add failing metadata, object-list, workspace-addressed and bucket-list tests
      separately; implement each gate integration and observe it pass.
- [x] Cover absent, empty and different workspace bindings; tenant and workspace
      roles; foreign tenants; null/missing workspace mappings; request-field spoofing;
      authorized binary reads; Range/416; and manifest path/binding checks.
- [x] Preserve owner/admin structural writes and deny read-only callers' writes.
      Reuse one bucket record for structural authorization.
- [x] Run the new suite and unchanged object-key-validation, storage-quota-handlers,
      model-authz and storage XML parsing suites: 173/173 tests pass in process.
      No timeout wrapper, dependency stub or loader is used.
- [x] Add the OpenSpec proposal and workspace-authorization requirement delta.
- [x] Verify node --test tests/blackbox/storage-workspace-authz.test.mjs also passes
      with the default subprocess-isolated runner. Use the in-process runner for
      detailed per-assertion evidence, including the initial red reproduction.

## CI and Runtime Handoff

- [ ] Run tests/unit/workspace-model-authz.test.mjs with installed dependencies.
      The in-process attempt cannot import missing kafkajs. Existing manifests
      already declare it; no dependency or lockfile update is needed.
- [ ] Build and scan the control-plane image through normal PR CI/release gates.
      Container/image/network checks are unavailable in this sandbox.
- [ ] Complete independent R3 maker/checker review by both providers and human
      approval through the control plane.
- [ ] Replay the original deployed unbound-viewer reproduction and expect
      404 BUCKET_NOT_FOUND before S3. There is no isolated live runtime here.
- [ ] Confirm product migration messaging for unbound tenant_developer users and
      decide whether #973 remains an umbrella for the other resolver follow-ups.
