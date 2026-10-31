## MODIFIED Requirements

### Requirement: Console tests observe completed async state

The six tests named in issue #1487 SHALL wait for the rendered element, route commit, focus or transition they assert, while preserving all existing expectations. They SHALL NOT introduce fixed wall-clock sleeps or change test timing, retry or worker configuration.

#### Scenario: Operations unmount under a paused clock

- **WHEN** the lifecycle test navigates to an operation detail during debounce, session or reconciliation
- **THEN** it advances the paused clock before asserting the detail is mounted
- **AND** it still verifies the detail URL, request aborts and exact traffic for each stage.

#### Scenario: Pending catch-all lazy chunk

- **WHEN** the catch-all route is pending
- **THEN** the test asynchronously observes main#not-found-loading and its Cargando status before asserting the final heading focus
- **AND** the test fails if the skeleton is never rendered.

#### Scenario: Allocation retry focus in both languages

- **WHEN** a retry is pending, fails or recovers in es or en
- **THEN** each focus assertion waits individually for the retry control or recovered h1 to receive focus.
- **AND** clicking the first retry control before the preceding render's focus effect runs preserves that control while its request is pending.

#### Scenario: Quotas error and empty states

- **WHEN** the parity test opens a quota state
- **THEN** it waits for the quotas surface and its loading completion, and observes the declared state before inspecting tables, request IDs or links
- **AND** a successful retry waits for the recovered two tables.

#### Scenario: Signup success accessibility

- **WHEN** signup completes successfully
- **THEN** the test waits for the success toast's computed opacity to reach 1 before running full-page axe
- **AND** no element or accessibility rule is excluded.

#### Scenario: Legacy signup form after its layout

- **WHEN** the layout heading renders before signup policy resolves
- **THEN** the regression test awaits the username label after releasing the policy response.

#### Scenario: Repeated and regression validation

- **WHEN** validation runs in an environment with the required tools
- **THEN** each affected unit test and each existing browser role/locale/viewport case passes 30 repetitions
- **AND** the normal next-console suite, legacy suite, parity scan and parity validation pass
- **AND** unavailable sandbox checks are explicitly handed off to PR CI without claiming success.
