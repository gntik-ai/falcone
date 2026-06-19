# fix-realtime-replication-pool-protocol

## Change type
bugfix

## Capability
realtime

## Priority
P1

## Why
With realtime fully wired (executor `REALTIME_DOCUMENTDB_URL` set, `wal_level=logical`, publication
`falcone_cdc_pub` + `REPLICA IDENTITY FULL`), an SSE subscription to a collection change-stream opens
(HTTP 200) but delivers ZERO change events — the first and only frame is
`event: error / data: {"code":"08P01"}`, and the DocumentDB server logs
`ERROR: extended query protocol not supported in a replication connection`. GitHub issue #626.

**Root cause (code-verified).** The realtime executor builds its provisioning pool as
`new pg.Pool(engineConnectionConfig)` where `engineConnectionConfig = { connectionString: REALTIME_DOCUMENTDB_URL }`
(`apps/control-plane/src/runtime/realtime-executor.mjs:27`). When that URL carries `replication=database`
(the live-campaign secret sets `…?sslmode=disable&replication=database` in
`tests/live-campaign/make-secrets.sh:89`), the pool's connections are themselves *replication* connections.
`ensureStarted()` then runs the **parameterized** provisioning queries in
`ensurePublicationAndReplicaIdentity` / `createFreshSlot` (e.g. `SELECT 1 FROM pg_publication WHERE pubname = $1`,
`services/mongo-cdc-bridge/src/provisionLogicalReplication.mjs:19`). Postgres rejects any
extended-query-protocol (parameterized/prepared) message on a replication connection with `08P01`. The error
throws synchronously inside `subscribe()` and is caught at `apps/control-plane/src/runtime/server.mjs:658`,
which writes `{ code: err.code }` → `{"code":"08P01"}`.

The replication CONSUMER does not need the URL to carry `replication=database`: the
`pg-logical-replication` `LogicalReplicationService` forces `replication: 'database'` on its own client
(`logical-replication-service.js:35-38`). The flag is therefore redundant for the consumer and actively
harmful for the provisioning pool. `tests/e2e/stack.sh:174` already documents this ("this is a NORMAL
connection URL — do NOT append ?replication=database"); the live-campaign secret violated it.

Secondary: the SSE error frame carries only `{"code":"08P01"}` — the underlying PG error *message* is
dropped, so the failure is undebuggable from the client side.

## What Changes
- `apps/control-plane/src/runtime/realtime-executor.mjs`: derive the engine **pool** config from a
  sanitized copy of `engineConnectionConfig` that strips any replication flag (the `replication` key and a
  `replication=…` query parameter on `connectionString`), so the provisioning pool is ALWAYS a normal
  (simple-protocol-capable) connection regardless of the operator-supplied URL. The replication client is
  unchanged — it forces `replication: 'database'` itself.
- `tests/live-campaign/make-secrets.sh`: drop `&replication=database` from `realtime-url`, matching the
  documented `tests/e2e/stack.sh` convention.
- `apps/control-plane/src/runtime/server.mjs`: include the underlying error message (not only the code) in
  the realtime SSE `event: error` frames (both the pre-stream catch path and the streaming `onError` path).

## Impact
- Realtime SSE subscriptions deliver insert/update/delete change events instead of an immediate
  `08P01` error frame, even when the operator supplies a `replication=database` URL.
- No change to tenant scoping, the route contract, or the `onChange` event shape.
- Affected specs: `realtime`.
