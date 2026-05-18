## Goals

1. Postgres → Kafka latency under 1s p99 for individual change events at the
   bridge layer (excluding broker fan-out).
2. A `pg_capture_configs` row flipped to `active` at T+0 produces events on the
   matching Kafka topic by T+`PG_CDC_CONFIG_REFRESH_SECONDS` (default 30s) with
   no process restart.
3. A bridge restart resumes streaming from the last persisted `lsn_acked` with
   no data loss above at-least-once duplicate window.

## Non-goals

- **Switching to Debezium.** Listed as audit option 2; rejected here because the
  existing scaffold + control surface is otherwise correct, and a Debezium
  swap-in is a larger migration with operator-tooling implications.
- **Slot failover across replicas.** Logical replication slots are not
  replicated by default; cross-region HA is a deferred concern.
- **Schema-evolution handling.** `relation` re-emissions are consumed and the
  decoder memoises them, but DDL events (drop/rename) only surface as stream
  invalidation today — covered by fix-d2-tuple-decoder, not here.

## Why a per-data-source publication, not one global publication

Postgres allows tables to belong to multiple publications, but a logical slot
binds to exactly one slot name and replays per the publication argument supplied
at `START_REPLICATION`. Per-ref publications give:

1. Tenant/workspace isolation at the WAL filter layer (the broker is no longer
   the only enforcement point).
2. Smaller WAL bandwidth per slot — only the captured tables stream.
3. A clean reconciliation point: adding a `pg_capture_configs` row for ref R
   triggers `ALTER PUBLICATION baas_cdc_<R> ADD TABLE …` and nothing else.

## Slot and publication naming

- Slot: `cdc_<sha1[:8](data_source_ref)>` — existing scheme retained.
- Publication: `baas_cdc_<sha1[:8](data_source_ref)>` — same prefix space, never
  collides with the slot name (slots and publications live in different
  namespaces in Postgres).

## Status update cadence

Postgres recycles WAL based on the highest `confirmed_flush_lsn` reported by any
slot. The bridge MUST send `Standby Status Update (r)` at least every
`wal_sender_timeout / 2` (default 30s server-side, so we ship at 10s) carrying
the latest `lastAckedLsn` that has been persisted to `pg_capture_configs` AND
acknowledged by Kafka. Sending a higher LSN before Kafka ack would risk WAL
recycling past unflushed events on bridge crash.

## Config refresh loop

`WalListenerManager._refreshConfigs()` runs on a `setInterval(unref)` at
`PG_CDC_CONFIG_REFRESH_SECONDS`. It:

1. `SELECT DISTINCT data_source_ref FROM pg_capture_configs WHERE status =
   'active'`.
2. Diff against `this.listeners.keys()`.
3. For each new ref: ensure publication exists (`PublicationManager.ensure`),
   then spawn listener.
4. For each removed ref: `listener.stop()` and `publicationManager.drop(ref)`
   if no active configs remain.
5. For each existing ref: `CaptureConfigCache.invalidate(ref)` so the next
   `RouteFilter.match` reads fresh table membership; reconcile publication
   table membership.

## Out-of-scope notes

This change does **not** repair the decoder bugs (B4, B8, B11, B12, B13) — those
are owned by `fix-d2-tuple-decoder`. Streaming will be wired but UPDATE events
will still corrupt their tuple until that change lands. The two changes are
sequenced so `fix-d2-tuple-decoder` ships first if both are merged in the same
window.
