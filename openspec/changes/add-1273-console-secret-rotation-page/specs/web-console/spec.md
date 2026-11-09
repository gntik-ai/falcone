## ADDED Requirements

### Requirement: Bounded secret rotation page and requests

The next console SHALL lazily serve `/console/secrets/:encodedSecretPath/rotate`
under `/next/`, with resource-form composition from pinned gntik-ui 0.11.0 and
tokens 0.3.0, explicit props and complete es-default/en copy. It SHALL preserve
server-side authorization without adding a page role guard. All page requests
SHALL use console-api session transport and the current legacy path validation.

#### Scenario: Valid path and the three routed endpoints

- **WHEN** `/console/secrets/platform%2Fdb-password/rotate` loads
- **THEN** the header SHALL show the translated rotation title and decoded path.
- **AND** the only page-owned requests SHALL be GET
  `/v1/platform/secrets/platform/db-password/history?limit=20&offset=N`, GET
  `/v1/platform/secrets/platform/db-password/consumer-status` without query, and
  an explicitly confirmed POST `/v1/platform/secrets/platform/db-password/rotate`.
- **AND** history SHALL start at offset 0, page by 20 when total exceeds 20 and
  retry its current limit/offset without touching the consumer poller.
- **AND** domain/name SHALL be encoded as in legacy; a valid tenant path SHALL
  retain the legacy omission of its middle tenant segment from request URLs.
- **AND** no version-revoke endpoint SHALL be called. The three used endpoints
  SHALL be treated as routed, with 404 retained as an error state, not NO_ROUTE.
- **AND** shell tenant bootstrap and session refresh SHALL remain separate from
  this page-owned request allowlist.

#### Scenario: Invalid path

- **WHEN** the decoded path fails the legacy shape check, including
  `sample-encodedSecretPath` or `platform%2Fpostgresql%2Fapp-password`
- **THEN** the page SHALL show the translated h1 (`Rotar secreto` in es) and a
  not-found state linking to `/console/secrets`.
- **AND** it SHALL render no form, send no page-owned requests and start no timer.

### Requirement: Exact form and irreversible submission contract

The page SHALL preserve the legacy field values and request body while requiring
typed destructive confirmation for each submission. It SHALL never automatically
retry the rotation POST or expose the new value in feedback.

#### Scenario: Grace input and native required semantics

- **WHEN** the form first renders
- **THEN** grace SHALL default to 1800; the plain number input SHALL have min 300
  and max 86400 and use `Number(value)` without clamping or blocking submission.
- **WHEN** the number input is 120, 0 or cleared
- **THEN** the slider SHALL display and expose 300 while the input and POST SHALL
  keep the numeric value (clearing produces 0).
- **WHEN** the number input is 90000
- **THEN** the slider SHALL expose 86400 and the POST SHALL send 90000.
- **AND** slider keyboard Home/End SHALL select 300/86400.
- **AND** justification SHALL have native `required` and no `aria-required`;
  the form SHALL use `noValidate` so empty justification sends `''` without a
  native validation bubble. The kit clamping number-input SHALL not be used.

#### Scenario: Confirmation, exact body and local discard

- **WHEN** Enviar rotación opens confirmation
- **THEN** focus SHALL enter the confirmation input and confirmation SHALL enable
  only for exact equality with the decoded secret path.
- **AND** Cancelar or Escape SHALL send nothing and restore the submit trigger.
- **WHEN** `platform/db-password` is confirmed
- **THEN** exactly one POST SHALL send body keys exactly `gracePeriodSeconds`,
  `justification` and `newValue`, with no `secretPath` key.
- **AND** submit and Descartar SHALL be disabled and the bar SHALL expose busy
  saving state until the POST settles; double activation SHALL send nothing.
- **AND** success SHALL announce/toast the returned `vaultVersionNew` and
  localized `graceExpiresAt`, preserving all form values.
- **WHEN** Descartar is activated outside a pending POST
- **THEN** grace SHALL reset to 1800 and both text fields to empty locally.

#### Scenario: Submit failure requires a new confirmation

- **WHEN** rotate fails with 400, 403, 404, 500, 503 or a network error
- **THEN** a focused validation-summary, toast and live announcement SHALL report
  the server message or localized network fallback, with new-value echoes redacted.
- **AND** fields SHALL remain available; advancing time by 60 seconds SHALL send
  no further POST. Another POST SHALL require a new submit and confirmation.
- **AND** the new value SHALL remain masked and absent from DOM text, confirmation,
  summaries, toasts, announcements, console logs and visual artifacts. Fixtures
  SHALL contain synthetic values only.

### Requirement: Independent history and consumer states

History and consumer status SHALL render as subordinate lists with translated
headers, explicit tables, skeletons, empty states and section-owned failure UI.

#### Scenario: Data and section errors

- **WHEN** history and consumer reads are pending for the first time
- **THEN** each section SHALL show a skeleton; empty successful responses SHALL
  show the corresponding no-results state.
- **AND** history SHALL accept snake_case and camelCase event fields, show event,
  actor, timestamp and both versions, with translated missing-value fallback.
- **AND** consumers SHALL show id, reload mechanism and status-tag tones for
  confirmed, pending and timeout.
- **WHEN** a section read returns 403 or 404
- **THEN** it SHALL show no-access without request-access, or not-found with a
  `/console/secrets` link, respectively.
- **WHEN** a read fails with 500 or a network error
- **THEN** its error-panel SHALL provide Reintentar, status when available and
  request ID or explicit no-request-id copy. History SHALL clear its rows;
  consumer data SHALL remain visibly stale with its localized last-success time.
- **AND** successful consumer recovery SHALL remove the error and stale marker.
- **AND** 401 SHALL use the shell's session refresh/redirect handling.

#### Scenario: One consumer timer and independent retry

- **WHEN** the consumer response is empty, contains a pending consumer or fails
- **THEN** one 5000 ms timer SHALL schedule the next poll, including after 404.
- **WHEN** consumer Reintentar is activated
- **THEN** it SHALL poll once immediately and replace, never duplicate, the timer.
- **WHEN** the nonempty collection is entirely confirmed or timeout, or the page
  unmounts
- **THEN** polling SHALL stop and its timer SHALL be cleared.
- **AND** history retry SHALL never reset or duplicate the consumer timer.

### Requirement: Parity verification and staged rollout

Verification SHALL preserve existing tests, the browser-session query guard, CSP
harness and dependency pins. The implementation SHALL ship beside legacy until
parity gates and operator review permit navigation rollout.

#### Scenario: Local, browser and visual coverage

- **WHEN** the page is verified
- **THEN** the three legacy cases SHALL have passing equivalents on
  `platform%2Fdb-password`, with an additional invalid three-segment-path case.
- **AND** Vitest SHALL cover exact requests, field semantics, all states, access,
  focus, single-flight/no retry and polling cadence, retries and cleanup.
- **AND** the mocked journey SHALL cover data, actions, errors/empty, axe, locale,
  runtime health, responsive composition and kit conformance in es/en at 375,
  768 and 1280 px, with no page overflow or unmatched request and visible focus.
- **AND** CSP SHALL retain `unmatched: []`, including the invalid sample path.
- **AND** visual scenarios SHALL cover unsaved/paged history and mixed consumers
  (`rotation-history-page1`, `rotation-consumers-mixed`), confirmation, saving
  (`rotation-rotate-slow`), success (`rotation-rotate-ok`), validation/403
  (`rotation-rotate-400`, `rotation-rotate-403`), stale consumer failure
  (`rotation-consumers-500-then-ok`) and not-found (`rotation-history-404`).
- **AND** unavailable sandbox browser/MCP checks SHALL be recorded honestly;
  code and fixture coverage SHALL be reviewed here, PR CI SHALL capture es/en
  screenshots and run browser gates, and the operator SHALL review baselines.

#### Scenario: Navigation rollout and rollback

- **WHEN** the page is delivered before PARITY_PASS
- **THEN** the direct `/next/` route SHALL remain available while its migrated
  navigation flag stays unset and existing inventory links hand off to legacy.
- **WHEN** parity passes and migrated navigation is enabled
- **THEN** removing that flag SHALL return navigation to legacy.
- **AND** disabling the direct `/next/` route SHALL additionally require reverting
  its rotation dispatch branch in `src/router.tsx` to pendingPage, since that
  branch currently does not test the flag.
- **AND** rollback SHALL not claim to restore already rotated secrets; legacy
  deletion, backend/gateway changes and deployment changes SHALL remain out of scope.
