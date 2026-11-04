## ADDED Requirements

### Requirement: Live bounded secrets inventory

The next console SHALL serve `/console/secrets` through its migrated flag and lazy
dispatch, without a page role guard or new navigation entry. It SHALL compose the
resource-index layout from gntik-ui 0.11.0 with explicit data and label props and
complete es-default/en copy, accessible names, announcements and locale timestamps.

#### Scenario: Load and count returned rows

- **WHEN** the page loads with sole principal tenant ID `tenant-a`
- **THEN** it SHALL send one GET `/v1/secrets/inventory?domain=platform` and one
  GET `/v1/secrets/inventory?domain=tenant&tenantId=tenant-a`, without limit/offset.
- **AND** a table skeleton SHALL remain until both requests settle.
- **AND** rows SHALL show name, translated domain/state, tenant ID or dash and
  `currentVersion.activatedAt` as the last rotation; state SHALL be active or grace.
- **AND** null currentVersion SHALL show translated no-active-version copy with
  no version or date and a disabled revoke action.
- **AND** 50 returned rows per domain SHALL render 100 rows with count 100 and an
  only-returned-rows notice in both locales, without pagination or total wording.
- **AND** empty inventories SHALL show the first-run empty surface.

#### Scenario: Inventory failures and keyboard retry

- **WHEN** either domain GET fails
- **THEN** no partial table SHALL render; other errors SHALL take precedence over
  403, then 404, across both outcomes.
- **AND** 403 SHALL show no-access, 404 not-found, and other/network errors an
  error-panel with status/request ID when available and explicit retry.
- **WHEN** inventory retry is activated
- **THEN** one GET per domain SHALL be sent, with skeleton until resolution.
- **AND** focus SHALL return to the new retry button on a retriable failure, or
  to the named inventory region after rows, empty or terminal failure render.
- **AND** inventory 401 SHALL follow the shared session refresh and single replay.

### Requirement: Target-bound irreversible revocation

Revoke SHALL be available only for a non-null valid currentVersion and a valid
legacy secret name with an exact server-derived path. Platform paths SHALL equal
`platform/{name}` independently of tenant binding. Tenant paths SHALL equal
`tenant/{T}/{name}`, with row.tenantId equal to T, where T comes exclusively from
the session's sole principal.tenantIds entry, never activeTenantId.

#### Scenario: Unbound inventory rows

- **WHEN** db-password belongs to tenant-b for principal tenant-a, a platform path
  is `platform/postgresql/app-password`, or currentVersion is null
- **THEN** revoke SHALL be disabled with translated explanatory copy, open no
  dialog and send no POST; Rotate and History SHALL remain available.
- **AND** binding SHALL be checked again immediately before POST against the
  same current session snapshot supplying the bearer token.

#### Scenario: Typed confirmation and exact requests

- **WHEN** a bound revoke opens
- **THEN** the AlertDialog SHALL focus the name input, require exact case-sensitive
  equality, initialize force from requiresForce on every open, show the last-valid
  warning when required and allow optional justification.
- **WHEN** bound db-password version 1 is confirmed
- **THEN** exactly one POST SHALL target
  `/v1/platform/secrets/tenant/db-password/versions/1/revoke` with body keys exactly
  justification and forceRevoke, initially true.
- **WHEN** bound app-password version 2 is confirmed
- **THEN** exactly one POST SHALL target
  `/v1/platform/secrets/platform/app-password/versions/2/revoke`, initially false.
- **AND** in-flight controls SHALL be busy/disabled and double click or Enter SHALL
  not send another request; cancellation/Escape SHALL send nothing and restore
  focus to the same row's revoke button.
- **AND** success SHALL close the dialog, toast and announce the result without
  an inventory refetch or optimistic row change.

#### Scenario: Revoke failure and explicit retry

- **WHEN** revoke returns 403
- **THEN** the dialog SHALL show no-access without request-access UI; Close SHALL
  restore focus to the revoke trigger.
- **WHEN** revoke returns 404 using fixture `secret-revoke-404-not-found`
- **THEN** it SHALL show not-found naming the secret/version with Back to inventory
  and View history; closing SHALL return focus to the same trigger.
- **WHEN** revoke returns another status, including 409/500/503, or a network error
- **THEN** it SHALL keep the dialog and typed name, justification and force choice,
  show an error-panel and send one POST per explicit retry.

#### Scenario: Revoke 401 never replays

- **WHEN** the revoke POST returns 401
- **THEN** exactly one revoke POST and one auth refresh POST SHALL be sent, even
  if refresh fails; revoke SHALL never replay automatically.
- **AND** the session SHALL invalidate and redirect to login with the protected
  return path `/console/secrets`, without an unhandled rejection.

### Requirement: Legacy hand-off, rollback and verification

#### Scenario: Rotation and history remain legacy

- **WHEN** Rotate or History is followed
- **THEN** its root-relative destination SHALL be
  `/console/secrets/{encodeURIComponent(row.path)}/rotate`, including under /next.
- **AND** no history, consumer-status or rotate request SHALL originate here.

#### Scenario: Rollback

- **WHEN** the secrets dispatch and migrated flag are reverted
- **THEN** `/next/console/secrets` SHALL render pendingPage without inventory
  calls, navigation SHALL hand off to legacy and legacy tests SHALL remain intact.

#### Scenario: Parity and visual coverage

- **WHEN** mocked parity runs in es/en at 375, 768 and 1280 px
- **THEN** it SHALL cover data, actions, loading/empty/errors, accessibility,
  runtime health, responsiveness, kit conformance and visual-review states.
- **AND** only shell bootstrap, exact inventory GETs, revoke POST and auth refresh
  in 401 fixtures SHALL be allowed, with no unmatched requests.
- **AND** keyboard focus SHALL be visible, all actions reachable without horizontal
  page overflow, and axe SHALL report no serious or critical violation.
- **AND** visual fixtures SHALL cover `platform-secrets-static-inventory`, force
  confirmation, `secret-revoke-403`, `secret-revoke-404-not-found` and
  `secret-revoke-500`; unavailable sandbox screenshots SHALL not block review of
  code and fixtures. PR CI SHALL capture baselines for operator review.
- **AND** CSP at root and /next, normal Vitest, separate fixture tests, legacy and
  console-api regressions, typecheck, build, i18n/colour lints and parity structure
  gates SHALL remain enforced without weakening existing tests or CI gates.
