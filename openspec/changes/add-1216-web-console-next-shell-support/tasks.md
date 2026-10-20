- [x] Verify clean assigned worktree and immutable source base.
- [x] Derive public seams from acceptance criteria and observe failing tests per slice.
- [x] Add optional denial copy and preserve translated defaults and allowed content.
- [x] Add optional migration metadata and router-aware sidebar/mobile links.
- [x] Preserve router basename in intent without touching shared session semantics.
- [x] Supply persisted sessions synchronously to page tests without auth lifecycle.
- [x] Register parity page fixtures and opt-in workspace roles.
- [x] Support delayed, failing and fail-then-succeed endpoint scenarios.
- [x] Preserve unmatched teardown and external abort with negative controls.
- [x] Keep numeric context status and classify only 403 as no access.
- [x] Document shell and parity extension contracts.
- [x] Record bounded validation: 136 production-mode Vitest assertions plus all
  3 dedicated fixture assertions pass; typecheck, i18n resource/literal checks,
  colour lint, parity scan/validation, parity tools and i18n CLI fixtures pass.
- [x] Build fixture bundles at / and /next/; namespace chunk checks pass.
- [x] Build release at /next/ and pass the fixture-exclusion test.
- [ ] Run shell and parity browser suites, including seeded negative controls,
  at both bases in CI. Sandbox limits: shell setup reports listen EPERM on
  127.0.0.1; parity launch lacks the pinned chromium_headless_shell-1208 binary.
- [ ] Complete human approval, both-provider review and staging verification
  through the control plane before any merge/deployment/release.
