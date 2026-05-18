## Why

The restore-confirmation surface has three correctness defects that
collapse risk classification and undermine 2FA: snapshot age defaults to
"now", OTP empty codes are submitted to Keycloak, and the
`isOutsideOperationalHours` parameter is dead. From
`openspec/audit/cap-l1-backup-status-operations-audit.md`:

- **B6** (`confirmations/confirmations.service.ts:162-169`) — when
  `resolveSnapshotCreatedAt` is undefined or returns null,
  `snapshotCreatedAt = new Date()`; the risk calculator computes age 0
  for a year-old snapshot; risk drops elevated → normal.
- **B9** (`second-factor/otp-verifier.ts:32`) — `otpCode ?? ''` allows
  empty string to be POSTed to Keycloak; rejection is post-hoc only;
  multiple submissions are possible within the 5s fetch window.
- **B10** (`risk-calculator.ts:23-71`) —
  `isOutsideOperationalHours` is declared at `:27` and used at `:64`,
  but all callers (`confirmations.service.ts:240`) pass `false`;
  outside-hours warnings never elevate risk.
- **G23** (`G-S3.4`) — OTP code length/format not validated client-side
  (same as B9, raised).
- **G24** (`G-S3.5`) — no replay protection on OTP within the 5s fetch
  window (same as B9, related).
- **G26** (`G-S3.7`) — `isOutsideOperationalHours` dead parameter (same
  as B10, raised).
- **G27** (`G-S3.9`) — no audit on OTP failures or second-actor
  failures; pair with B9/B10 to ensure failures emit
  `restore.second_factor_failed` events.

## What Changes

- Require `resolveSnapshotCreatedAt` to return a non-null `Date`;
  throw `SNAPSHOT_AGE_UNAVAILABLE` (and surface as a blocking precheck
  failure) if the snapshot age cannot be established.
- Validate the OTP code format BEFORE the Keycloak round-trip: reject
  empty strings, non-digit content, and lengths outside
  `[6,8]` with `400 INVALID_OTP_FORMAT`.
- Pass the computed `isOutsideOperationalHours` value through to the
  risk calculator at `confirmations.service.ts:240`; remove the
  hardcoded `false`.
- Emit `restore.second_factor_failed` audit events on every OTP and
  second-actor verification rejection.

## Capabilities

### Modified Capabilities

- `backup-and-restore`: requirements on snapshot-age availability,
  OTP code validation, operational-hours risk propagation, and 2FA
  failure auditing.

## Impact

- **Affected code**:
  `services/backup-status/src/confirmations/confirmations.service.ts`,
  `services/backup-status/src/second-factor/otp-verifier.ts`,
  `services/backup-status/src/operations/risk-calculator.ts`.
- **Migration required**: none.
- **Breaking changes**: restore requests whose snapshot age cannot be
  resolved will now block at the precheck layer instead of silently
  proceeding with age 0; OTP submitters who relied on empty/short
  codes "for testing" will get 400.
- **Cross-cutting**: audit consumers gain `restore.second_factor_failed`
  events; classify and route accordingly.
