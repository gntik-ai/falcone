## 1. CI coverage

- [x] 1.1 Run headless workflow and restore E2E suites in `ci.yml` and retain
  their TAP and restore JSON artifacts.
- [x] 1.2 Gate secret-backed plan suites at the step level and enable strict
  plan-enforcement environment validation when the explicit gate is enabled.

## 2. Scheduled integration coverage

- [x] 2.1 Add a scheduled and manually dispatchable kind/Helm integration
  workflow using the pinned charts revision and deterministic E2E Helm adapter.
- [x] 2.2 Run all plan-enforcement suites in strict mode, fail if no
  non-skipped TAP test executes, upload reports, and tear down on every exit.
- [x] 2.3 Render the chart-owned CI credential, TLS, OpenBao-init, and webhook
  authority hooks in the isolated no-hooks Temporal lifecycle; use the
  locally-loaded control-plane image tag and serialize the fixed kind cluster.

## 3. Verify

- [x] 3.1 Run the workflow and restore suites locally without service
  credentials and record TAP pass/skip counts (workflows: 39 pass; restore:
  10 pass, 2 explicit skips).
- [ ] 3.2 Run workflow YAML validation and trigger the scheduled workflow in
  GitHub to confirm provision, execution, artifact upload, and teardown.

## 4. Action supply-chain pins

- [x] 4.1 Pin every `uses:` reference in `ci.yml` and `integration.yml` to a
  reviewed action commit SHA and retain its release version as a comment.
- [x] 4.2 Add a static regression test that rejects mutable, abbreviated, or
  uncommented action references.
