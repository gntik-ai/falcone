## Why

The `pgoutput` decoder in `services/pg-cdc-bridge/src/WalEventDecoder.mjs`
carries five confirmed correctness bugs. Suppressed today by the unwired
streaming path (`B1`), they become live the moment `complete-d2-wal-streaming-
end-to-end` lands. From `openspec/audit/cap-d2-pg-cdc-bridge.md`:

- **B4** (`services/pg-cdc-bridge/src/WalEventDecoder.mjs:31`) — `UPDATE` messages
  always read the tuple at offset 6 with hard-coded `oldRow: null`. In pgoutput,
  a `U` message includes `K` (key tuple) or `O` (full old tuple) before the `N`
  new tuple depending on `REPLICA IDENTITY`. The decoder reads the byte at
  offset 5 as a tuple-type indicator but `_decodeRowData` only acts on `N`/`K`/`O`
  for any other byte returning `{}`, so when `REPLICA IDENTITY DEFAULT` puts a
  `K` at offset 5 the decoder treats the key tuple's body as the new tuple and
  never sees the actual new row.
- **B8** (`WalEventDecoder.mjs:40`) — `_decodeRowData` reads the per-field kind
  byte (`:37`), special-cases only `'n'` (null), and treats every other kind —
  including `'b'` for binary — as UTF-8 via `buf.toString('utf8', …)`. A
  binary-encoded `bytea`/`numeric` column produces mojibake.
- **B11** (`WalEventDecoder.mjs:12`) — `try { … } catch { return null; }` with no
  log, no counter. Any decode bug becomes "no decoded message" and the listener
  short-circuits silently.
- **B12** (`WalEventDecoder.mjs:40`) — `len = buf.readUInt32BE(offset)` then
  `buf.toString('utf8', offset, offset + len)` with no bounds check. A
  malformed or adversarial message can wedge the decoder's offset state for the
  rest of the batch.
- **B13** (`WalEventDecoder.mjs:22`) — `_decodeRelation` skips the column flags
  byte; nothing later consults whether a column is part of REPLICA IDENTITY,
  which is part of why B4 is fatal.

## What Changes

- Rewrite `_decodeUpdate` to inspect the tuple-type byte at offset 5: if `K` or
  `O`, decode the old tuple and advance past it, then decode the `N` new tuple;
  if `N`, decode it as the new tuple with `oldRow = null`.
- Capture column flags (`columnFlags`) in `_decodeRelation` and stash them on
  the cached relation; use them to pick key columns when building `documentKey`
  for downstream consumers.
- Add a `'b'` (binary) branch to `_decodeRowData` that returns the raw `Buffer`
  slice; leave `'t'` as UTF-8 text and `'u'` (unchanged) as a sentinel.
- Add length-bounds checks: reject any field whose `offset + len > buf.length`
  and surface a `WAL_DECODE_BOUNDS_EXCEEDED` error.
- Replace the silent `catch { return null }` with a `metricsCollector.incr
  ('pg_cdc_decode_failures_total', {reason})` + `console.error` JSON log; return
  `null` so the listener still skips the message but operators see the failure.

## Capabilities

### Modified Capabilities

- `realtime-and-events`: pgoutput decoder correctness for UPDATE tuples, binary
  columns, length bounds, and decode-failure observability.

## Impact

- **Affected code**: `services/pg-cdc-bridge/src/WalEventDecoder.mjs`,
  `services/pg-cdc-bridge/src/MetricsCollector.mjs` (new counter),
  `services/pg-cdc-bridge/tests/unit/WalEventDecoder.test.mjs` (extended).
- **Migration required**: none — purely decoder logic.
- **Breaking changes**: consumers reading `cloudevents.data.row_payload` for
  UPDATE events will now receive the correct `newRow` (previously corrupted
  with key-tuple bytes for `REPLICA IDENTITY DEFAULT`). Binary columns will
  arrive as base64 `Buffer.toString('base64')` rather than mojibake strings.
- **Out of scope**: implementing the actual streaming wire-up (B1) — owned by
  `complete-d2-wal-streaming-end-to-end`.
