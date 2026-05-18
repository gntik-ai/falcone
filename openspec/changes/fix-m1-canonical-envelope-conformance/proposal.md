## Why

The one inline event constant in `services/audit/` diverges from the
canonical envelope on shape, enum, and version stamping — any consumer
that trusts the constant cannot route it through canonical infrastructure.
From `openspec/audit/cap-m1-audit-contract-surface.md`:

- **B3** (`services/audit/src/contract-boundary.mjs:24-43`) — the inline
  `capabilityEnforcementDeniedEvent` has 14 flat fields. The canonical
  schema (`observability-audit-event-schema.json:7-18`) requires 10
  envelope fields with `actor / scope / resource / action / result /
  origin` nesting.
- **B4** (same file `:32`) — `actorType: enum: ['user',
  'service_account']`. The canonical schema (`:45-52`) declares six
  values: `platform_user, tenant_user, workspace_user, service_account,
  system, provider_adapter`. The inline value `'user'` is not in the
  canonical enum.
- **B10** — `observability-audit-pipeline.json` and
  `observability-audit-event-schema.json` share `version:
  '2026-03-28'`, but the inline event carries no version. A contract
  bump silently breaks consumers.
- **G4** (same `:24-43`) — the inline event is a JS object, not a JSON
  Schema, so it cannot be validated.
- **G9** (`observability-audit-event-schema.json:173-185`) — additive-only
  evolution is asserted in the contract but unenforced.
- **G10** — version-stamping discipline is declared but not implemented.

## What Changes

- Rewrite `capabilityEnforcementDeniedEvent` to conform to the canonical
  10-field envelope: `event_id, event_timestamp, actor, scope, resource,
  action, result, correlation_id, origin, detail`.
- Replace the local `actorType` enum with the canonical
  `actor.actor_type` enum (six values); add a translation table for
  legacy consumers that emit `'user'` (mapping to `tenant_user` for the
  default tenant context, `platform_user` otherwise).
- Stamp the inline event with `schema_version: '2026-03-28'` (matching
  the canonical contract version).
- Add a contract-conformance test that runs the canonical schema
  validator against every inline event constant exported from
  `services/audit/`.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: canonical-envelope conformance of inline
  event constants, actor-type vocabulary, and schema-version stamping.

## Impact

- **Affected code**: `services/audit/src/contract-boundary.mjs`, new
  `services/audit/src/legacy-actor-type-map.mjs`,
  `services/audit/test/inline-events.contract.test.mjs`.
- **Migration required**: none at storage; legacy consumers receive a
  translation shim.
- **Breaking changes**: producers emitting `actorType: 'user'` now
  receive a translated value; consumers reading the inline event SHALL
  migrate to the canonical envelope nesting.
- **Out of scope**: building the validator runtime (covered by
  `complete-m1-audit-runtime-and-consumer`).
