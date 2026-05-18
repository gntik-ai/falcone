## Why

Two modules in the event-gateway capability hard-code different fallback
contract-version strings, so a single missing contract at startup yields a
two-day version drift to consumers. From
`openspec/audit/cap-f1-event-gateway.md`:

- **B2** (`apps/control-plane/src/events-admin.mjs:181` —
  `kafkaAdminRequestContract?.version ?? '2026-03-25'` —
  vs `services/event-gateway/src/runtime.mjs:564` and `:873` —
  both fall back to `'2026-03-24'`). One capability, two fallback dates;
  consumers see whichever module they happen to query.
- **G3** (cross-cutting) — the same "hard-coded fallback per module"
  anti-pattern appears in D1 and E1; the gateway tier is the most
  visible to external consumers and the most damaging when it drifts.

## What Changes

- Remove the literal fallback strings from `runtime.mjs:564, :873` and
  `events-admin.mjs:181`.
- Treat a missing contract version as a startup error: load the canonical
  version once from `services/internal-contracts` at boot, assert
  non-empty, and crash with a typed error otherwise.
- Surface a single `EVENT_GATEWAY_CONTRACT_VERSION` constant through
  `services/event-gateway/src/contract-boundary.mjs` so both the runtime
  and the control-plane façade consume the same value.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: contract-version reporting becomes a single source
  of truth resolved at bootstrap rather than per-call defaults.

## Impact

- **Affected code**: `services/event-gateway/src/runtime.mjs`,
  `services/event-gateway/src/contract-boundary.mjs`,
  `apps/control-plane/src/events-admin.mjs`.
- **Migration**: none — version is computed, not persisted.
- **Breaking changes**: a missing contract export now crashes the
  gateway at boot rather than silently shipping a stale date. This is
  intended; mis-configured deployments should fail loudly.
- **Out of scope**: contract content versioning policy (covered by the
  internal-contracts maintainer guide).
