## Why

`summarizeRelativeOrdering` is ambiguous: it computes a `sorted` array but
never reads it for violation detection, then mutates the same `Map` whose
entries it is iterating. From `openspec/audit/cap-f1-event-gateway.md`:

- **B3** (`services/event-gateway/src/runtime.mjs:840-846`) — the function
  builds `sorted` at `:840` and uses it only to derive `sequenceSpan` at
  `:848`. The violation loop iterates the unsorted `groupDeliveries` in
  arrival order. The dead variable indicates a design–implementation
  divergence: either the spec is "flag out-of-order arrivals" (then
  remove `sorted`) or "compare arrival vs. sequence order" (then walk
  `sorted` and compare against `groupDeliveries`).
- **B11** (`services/event-gateway/src/runtime.mjs:849`) — the loop calls
  `groups.set(groupKey, {deliveries, sequenceSpan})` while iterating
  `groups.entries()`. Each iteration's `groupDeliveries` is the original
  array, but the rewritten value is the new object; any consumer that
  re-reads via `groups.get(groupKey)` after the loop sees the new shape,
  not the array. Fragile relative to V8 Map-iterator semantics.
- **G10** (cross-cutting) — the function's contract is undocumented;
  consumers cannot tell whether `ok: false` means "events arrived out of
  order on the wire" or "the sequence numbers do not increase
  monotonically".

## What Changes

- Commit explicitly to "detect out-of-order arrival relative to sequence
  number" (the implementation's de-facto behaviour): walk
  `groupDeliveries` in arrival order, flag any `current.sequence <=
  previous.sequence`.
- Stop mutating the iterated map: build a separate `groupSummaries`
  output map populated after the for-loop completes.
- Remove the dead `sorted` array; compute `sequenceSpan` from the
  arrival-order pass to avoid a redundant sort.
- Document the contract in a JSDoc block on the exported function.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: relative-ordering summarisation becomes
  deterministic in semantics and safe with respect to map mutation.

## Impact

- **Affected code**: `services/event-gateway/src/runtime.mjs`
  (`summarizeRelativeOrdering`).
- **Migration**: none — the function is pure.
- **Breaking changes**: the output shape adds an explicit
  `summaries: {[groupKey]: {deliveries, sequenceSpan}}` field. Existing
  consumers that read `groups.get(groupKey)` after the call must move to
  the new field; the legacy `groups` map MUST NOT carry the rewritten
  shape.
- **Out of scope**: any change to the partition/key grouping algorithm.
