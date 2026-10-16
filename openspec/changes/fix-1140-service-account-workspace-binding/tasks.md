## Implementation

- [x] Verify the clean assigned issue-1140 branch at source base
      c6c532bdaddb6bf9c051ea0e8049cc128b3fc537.
- [x] Reproduce before source edits with
      node --test tests/unit/service-account-workspace-binding.test.mjs.
      The handler omitted enabled:false and the role/workspace binding sequence.
      The detailed in-process run confirmed undefined instead of false.
- [x] Add the disabled provisioning sequence and observe the handler test pass.
- [x] Test the confidential-client enabled option red then green, retaining true
      as the default for existing callers.
- [x] Test exact workspace mapper creation, read-only retry and mismatch rejection
      red then green through the HTTP boundary.
- [x] Test inspection of client, default and optional scope mappers red then green.
- [x] Test failures throughout preparation and registry insertion; surface redacted
      deletion failures after role assignment.
- [x] Test uncertain enable outcomes red then green, including committed enable,
      uncommitted enable, failed read/disable/delete, and confirmed disable/delete.
- [x] Reject conflicting scope claims and privileged effective roles, and retain
      the service-account registry on unresolved final enable for operator review.
- [x] Test signed control-plane workspace GET scope, executor structural/API-key
      denials and storage reads/write denials without changing those gates.
- [x] Pin the existing role catalog/matrix and mapper contract; extend existing
      audience-test fakes without weakening audience assertions.
- [x] Run scoped creation, executor, storage, model authorization and HTTP harness
      regressions. All runnable scoped suites pass. Markdown lint and the
      authorization-model validator also pass. No dependency changes are required.

## Handoff

- [ ] Build/scan the image and complete independent PR CI/review in the normal
      publication pipeline; no deployment or publication is performed here.
- [ ] Optional post-merge operator token check: verified workspace_service_account
      and singular workspace_id W, with no workspace_ids.
- [ ] Track back-fill, user rebinding and revocation/rollback in #1140 follow-up.
