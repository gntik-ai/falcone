## Why

Four `getContract(...)` lookups in `services/audit/` are unverified — the
contract registry may not declare them, in which case the re-exports
silently resolve to `undefined`. The declared export and correlation
surfaces are likewise unread, and no test confirms whether they are
populated. From `openspec/audit/cap-m1-audit-contract-surface.md`:

- **B5** (`services/audit/src/contract-boundary.mjs:9-12`) — calls
  `getContract('audit_record' | 'iam_lifecycle_event' |
  'mongo_admin_event' | 'kafka_admin_event')`. Grep of
  `services/internal-contracts/src/index.mjs` found no matches; if the
  contracts are absent, all four `*Contract` exports are silently
  `undefined`.
- **B12** (`services/internal-contracts/src/`) —
  `observability-audit-export-surface.json` and
  `observability-audit-correlation-surface.json` are referenced by name
  but never read by any production code; whether they declare valid
  schemas is unverified.
- **G11** — `auditPersistenceAdapters = listAdapterPortsForConsumer(...)`
  returns whatever ports the registry attributes; no consumer inspects
  the list, no test asserts the list is non-empty.
- **G12** — `auditRelevantNegativeAuthorizationScenarios` is re-exported
  without filtering; whether the filter is intended or the variable is
  misnamed is unverified.

## What Changes

- Add a contract-presence test asserting every `getContract(id)` call in
  `services/audit/` resolves to a non-`undefined` object whose `version`
  is a non-empty string.
- Add a contract-presence test asserting
  `auditPersistenceAdapters` is non-empty (at least one adapter port is
  declared for `audit_module`).
- Add a JSON-Schema-validity test asserting both
  `observability-audit-export-surface.json` and
  `observability-audit-correlation-surface.json` parse as valid AJV
  schemas with at least one declared route operation id.
- Add a regression test asserting the variable
  `auditRelevantNegativeAuthorizationScenarios` is either filtered to
  audit-relevant scenarios or renamed to match its un-filtered behaviour.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: contract-presence test coverage of the
  audit-boundary re-exports.

## Impact

- **Affected code**: new
  `services/audit/test/contract-presence.test.mjs`,
  `services/audit/test/declared-surfaces.test.mjs`.
- **Migration required**: none.
- **Breaking changes**: none at runtime; the tests will fail today if
  the contracts are absent (per the audit's grep finding) — that
  failure is the intended signal, prompting either contract declaration
  or removal of the re-exports.
- **Out of scope**: implementing the export and correlation runtime
  surfaces (separate proposals).
