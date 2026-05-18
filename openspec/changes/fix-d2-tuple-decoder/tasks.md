## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/pg-cdc-bridge/tests/unit/WalEventDecoder.update.test.mjs`
      feeding a hand-crafted `U` message with `REPLICA IDENTITY DEFAULT` (`K`
      tuple then `N` tuple) and assert `decoded.newRow` equals the new-tuple
      values, not the key-tuple bytes — fails today.
- [ ] 1.2 [test] Add a case feeding a tuple with a `'b'` kind byte and assert
      `decoded.newRow.<col>` is a `Buffer`, not a mojibake string.
- [ ] 1.3 [test] Add a case feeding a malformed tuple whose length field
      exceeds the buffer; assert the decoder emits `pg_cdc_decode_failures_total`
      with `reason='bounds_exceeded'` and returns `null` rather than crashing
      the listener.
- [ ] 1.4 [test] Add a case asserting `_decodeRelation` stores
      `columns[i].isKey` (true/false) on the cached relation so downstream
      consumers can identify key columns.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `_decodeUpdate` in `WalEventDecoder.mjs:30-32` to read
      byte at offset 5: if `K` or `O`, call `_decodeRowData` for `oldRow` and
      advance offset past it, then read the `N` byte and call `_decodeRowData`
      for `newRow`; if `N`, set `oldRow = null` and decode the new tuple.
- [ ] 2.2 [fix] Patch `_decodeRelation` at `WalEventDecoder.mjs:22` to capture
      the column flags byte as `isKey = (flag & 1) === 1` and emit it on the
      cached relation.
- [ ] 2.3 [fix] Add a `'b'` branch to `_decodeRowData` at `WalEventDecoder.mjs:40`
      returning `buf.subarray(offset, offset + len)` as a `Buffer`; add a `'u'`
      branch returning the sentinel `{__unchangedToastedValue: true}`.
- [ ] 2.4 [fix] Add length-bounds validation in `_decodeRowData`: if
      `offset + len > buf.length`, throw `WAL_DECODE_BOUNDS_EXCEEDED` with the
      relation id, column index, declared len, and remaining buffer.
- [ ] 2.5 [fix] Replace the bare `catch { return null }` at `WalEventDecoder.mjs:12`
      with a typed catch: `metricsCollector.incr('pg_cdc_decode_failures_total',
      {reason: err.code ?? 'unknown'})`, structured `console.error` JSON log
      with `{lsn, relationId, err}`, then `return null`.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the supported pgoutput field kinds (`t`/`b`/`n`/`u`)
      and the REPLICA IDENTITY contract in `services/pg-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-d2-tuple-decoder --strict`; both green before merge.
