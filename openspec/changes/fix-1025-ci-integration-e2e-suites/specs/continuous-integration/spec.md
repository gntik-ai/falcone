# continuous-integration — spec delta for fix-1025-ci-integration-e2e-suites

## ADDED Requirements

### Requirement: CI actions are immutable and reviewable

Every `uses:` reference in `ci.yml` and `integration.yml` SHALL name one of
the approved actions and pin it to a full lowercase 40-character commit SHA.
Each pin SHALL retain the corresponding release version in a trailing comment.

#### Scenario: Mutable or incomplete action pin is rejected

- **WHEN** a workflow contains a tag reference, abbreviated SHA, SHA without a
  release-version comment, or an unapproved action
- **THEN** the static workflow action-pin test fails.

### Requirement: CI executes the headless workflow and restore E2E suites

The pull-request and main-push CI workflow SHALL execute the workflow and
restore E2E suites. TAP output for both and the restore JSON report SHALL be
preserved as build artifacts, and an assertion failure in either suite SHALL
fail the workflow.

#### Scenario: Restore scenario remains explicitly skipped

- **WHEN** a restore scenario invokes its documented `t.skip` condition
- **THEN** the CI TAP output reports that skip while the remaining scenarios
  continue to execute and failures remain non-zero exits.

### Requirement: Plan-enforcement CI coverage fails closed

Secret-backed plan-enforcement and plan upgrade/downgrade checks SHALL be
visibly gated at the CI step level. When the plan-enforcement gate is enabled,
the suite SHALL set `PLAN_ENFORCEMENT_STRICT=true` so missing required
configuration fails the job rather than producing a successful all-skipped run.

#### Scenario: Strict scheduled suite executes

- **WHEN** the scheduled or manually dispatched integration workflow provisions
  its disposable Helm stack from the pinned chart revision
- **THEN** the plan-enforcement suite runs in strict mode, records TAP and JSON
  artifacts, confirms at least one non-skipped TAP test, and tears down the
  isolated stack even if the suite fails.
