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
      model-authz and storage XML parsing suites: the initial subset passed 173/173
      tests in process. This did not cover every storage blackbox suite; the
      follow-up below records the expanded verification and corrected fixtures.
- [x] Add the OpenSpec proposal and workspace-authorization requirement delta.
- [x] Verify node --test tests/blackbox/storage-workspace-authz.test.mjs also passes
      with the default subprocess-isolated runner. Use the in-process runner for
      detailed per-assertion evidence, including the initial red reproduction.

## Checker Follow-up

- [x] Verify the assigned branch is clean at supplied prior HEAD
      3ae6f2bdd409f1bfb19f5a2eaf40f60b182d4b70 before editing.
- [x] Reproduce the existing fixture regressions before corrections. For example,
      node --test --experimental-test-isolation=none
      tests/blackbox/storage-bucket-ownership-idor.test.mjs fails three assertions:
      an empty bucket list and 404 BUCKET_NOT_FOUND instead of authorized 200 reads.
      The not-found, write-envelope and credential-scope suites fail 4, 17 and 5
      assertions respectively. These identities omit verified roles and bindings.
- [x] Correct only fixture identities in those four suites, preserving all
      assertions. Developers use tenant_member actorType, tenant_developer roles
      and matching workspaceIds; owners carry tenant_owner roles. Each suite goes
      green immediately after its fixture correction: 54/54 tests pass.
- [x] Give storage-object-io-completeness the same verified owner role and binding
      fields. Its import is blocked locally by missing @temporalio/activity;
      it remains in the existing CI quality job for full runtime verification.
- [x] Wire workspace authorization, the four corrected runnable suites and
      object-key validation into the CI quality job. Preserve the Hermes chart pin.
- [x] Document actor_type-only owner tokens losing access in proposal compatibility
      notes; retain the roles-based gate and all structural-write safety checks.
- [x] Attempt every tests/blackbox/storage-*.test.mjs plus the three related unit
      suites individually, without timeouts, loaders or dependency stubs. The 11
      runnable blackbox suites pass 103/103 assertions; model-authz and storage XML
      parsing pass 149/149 (252 total). No production source adjustment is needed.
- [ ] Re-run the three storage suites with unavailable dependencies in PR CI:
      storage-object-io-completeness needs @temporalio/activity;
      storage-object-key-traversal and storage-credential-rotation-policy need cel-js.
      These imports prevent tests from running and are not assertion failures.

## Second Checker Follow-up

- [x] Verify the assigned branch is clean at supplied prior HEAD
      c531da721945957bb7430e06a1537434b91403d9 before editing.
- [x] Attempt the two newly identified regression suites before corrections:
      node --test tests/blackbox/structural-write-role-gates-kind.test.mjs cannot
      import kafkajs; node --test tests/blackbox/data-export-import-clone.test.mjs
      cannot import mongodb. These are environment skips, not observed assertion
      failures. No dependency stubs or manifest changes were introduced.
- [x] Add verified workspaceIds to the structural-write developer/viewer fixtures
      so they reach the existing 403 role gate. Add verified tenant_owner roles
      and workspaceIds to both export/import owner fixtures. Preserve assertions.
- [x] Include both regression suites in the CI storage authorization job.
- [x] Rename the manifest test to describe its positive read and path denial;
      binding denials remain covered by the workspace-addressed route tests.
- [x] Rename denyUnlessBucketOwner to denyUnlessBucketReader and derive tenant-tier
      roles once from the shipped authorization model, preserving gate behavior.
      The existing workspace authorization suite passes before and after these
      review refactors. No contract is read per request.
- [x] Expand verification beyond storage-* filenames: attempt all 14 storage
      blackbox suites, structural-write-role-gates-kind, data-export-import-clone,
      live-storage-function-quotas, seaweedfs-tenant-identities-default-on,
      legacy-components-absent, and model-authz, workspace-model-authz,
      tenant-role-storage and storage-handlers-xml-parsing unit suites.
      Sixteen suites pass; six cannot import missing packages and one cannot
      locate its default external chart checkout. No assertion regression is
      observed in the runnable storage suites.
- [ ] Run structural-write-role-gates-kind and workspace-model-authz with kafkajs,
      data-export-import-clone with mongodb and its transitive dependencies,
      storage-object-io-completeness with @temporalio/activity, and
      storage-credential-rotation-policy/storage-object-key-traversal with cel-js
      in dependency-installed CI. All packages are already declared.
- [ ] Run legacy-components-absent with the CI deployment checkout. Its default
      /srv/engineering/worktrees/falcone/falcone-charts/charts/in-falcone path
      is absent here; the source artifact check passes in the detailed run.

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
