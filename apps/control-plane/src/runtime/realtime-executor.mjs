// Realtime executor — re-architected onto Postgres logical replication (change
// add-ferretdb-realtime-cdc-remediation, #460).
//
// FerretDB v2 (postgres-documentdb) has no MongoDB change streams, so the realtime SSE engine
// consumes a pgoutput logical replication slot on the DocumentDB engine and fans WAL changes out to
// per-session subscribers. Tenant isolation is enforced CONSUMER-SIDE (the structural equivalent of
// the old change-stream $match): a session only receives a change when the row's tenantId matches the
// verified tenant — insert/update via fullDocument.tenantId, delete via the pre-image
// fullDocumentBeforeChange.tenantId (available because REPLICA IDENTITY FULL is set on the engine).
//
// One process owns ONE slot (slots are exclusive); it is created FRESH at startup (live-only — no
// history replay, no WAL pinning across restarts) and dropped on close. Multiple replicas must each
// use a distinct slotName.
import pg from 'pg'

import { WalReplicationClient } from '../../../../services/mongo-cdc-bridge/src/WalReplicationClient.mjs'
import { CollectionCatalog } from '../../../../services/mongo-cdc-bridge/src/CollectionCatalog.mjs'
import { ensurePublicationAndReplicaIdentity, createFreshSlot, dropSlot } from '../../../../services/mongo-cdc-bridge/src/provisionLogicalReplication.mjs'
import { clientError } from './errors.mjs'

// The realtime executor runs ordinary provisioning queries (publication lookup/creation, REPLICA
// IDENTITY FULL sweeps, slot create/drop) over a normal pg.Pool — and SOME of those are parameterized.
// Postgres rejects any extended-query-protocol (parameterized/prepared) message on a replication
// connection with `08P01: extended query protocol not supported in a replication connection`. So if the
// operator-supplied engine URL carries `replication=database` (as the live-campaign secret did), the pool
// must NOT inherit it. Strip any replication flag — the `replication` config key AND a `replication=…`
// query parameter on a connectionString — before building the pool. The replication CONSUMER is
// unaffected: pg-logical-replication forces `replication: 'database'` on its own client regardless.
export function nonReplicationConfig(config) {
  if (!config || typeof config !== 'object') return config
  const out = { ...config }
  delete out.replication
  if (typeof out.connectionString === 'string' && /[?&]replication=/.test(out.connectionString)) {
    try {
      const url = new URL(out.connectionString)
      url.searchParams.delete('replication')
      out.connectionString = url.toString()
    } catch {
      // Not a parseable URL — fall back to a textual strip of the replication parameter.
      out.connectionString = out.connectionString
        .replace(/([?&])replication=[^&]*&?/, '$1')
        .replace(/[?&]$/, '')
    }
  }
  return out
}

export function createRealtimeExecutor(options = {}) {
  const engineConnectionConfig = options.engineConnectionConfig
  if (!engineConnectionConfig) {
    throw new TypeError('createRealtimeExecutor requires engineConnectionConfig (DocumentDB engine, REPLICATION-privileged)')
  }
  const ownPool = !options.enginePool
  const makePool = options.poolFactory ?? ((cfg) => new pg.Pool(cfg))
  // The pool runs parameterized provisioning queries → must never be a replication connection (08P01).
  const enginePool = options.enginePool ?? makePool(nonReplicationConfig(engineConnectionConfig))
  const publicationName = options.publicationName ?? 'falcone_cdc_pub'
  const slotName = options.slotName ?? 'falcone_rt_slot'
  const catalog = options.catalog ?? new CollectionCatalog(enginePool)

  const subscribers = new Set() // { tenantId, database, collection, onChange, onError }
  let client = null
  let starting = null

  // Logical replication cannot distinguish a $set update from a replace; surface a WAL UPDATE as
  // 'replace' (full-document semantics, ADR-14). insert/delete pass through unchanged.
  const mapType = (walOp) => (walOp === 'update' ? 'replace' : walOp)

  function dispatch(record) {
    for (const sub of subscribers) {
      if (record.tenantId !== sub.tenantId) continue
      if (record.database !== sub.database || record.collection !== sub.collection) continue
      sub.onChange?.({
        type: mapType(record.operationType),
        documentId: record.documentId ?? null,
        // delete carries the prior doc as fullDocumentBeforeChange
        document: record.fullDocument ?? record.fullDocumentBeforeChange ?? null
      })
    }
  }

  async function ensureStarted() {
    if (client) return
    if (!starting) {
      starting = (async () => {
        await ensurePublicationAndReplicaIdentity(enginePool, publicationName)
        await createFreshSlot(enginePool, slotName)
        const c = new WalReplicationClient({ connectionConfig: engineConnectionConfig, slotName, publicationName, catalog, autoAck: true })
        c.on('change', dispatch)
        c.on('error', (err) => { for (const sub of subscribers) sub.onError?.(err) })
        await c.start()
        client = c
      })().catch((err) => { starting = null; throw err })
    }
    await starting
  }

  // Register a tenant-scoped SSE subscription. Calls onChange(event) per matching change and
  // onError(err) on the replication stream failing. Returns { close }; also closes on signal abort.
  // params: { workspaceId, databaseName, collectionName, identity:{tenantId}, onChange, onError, signal }
  async function subscribe(params) {
    const tenantId = params.identity?.tenantId
    if (!tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING')
    const workspaceId = params.workspaceId ?? params.identity?.workspaceId
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING')

    await ensureStarted()

    const sub = { tenantId, database: params.databaseName, collection: params.collectionName, onChange: params.onChange, onError: params.onError }
    subscribers.add(sub)

    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      params.signal?.removeEventListener?.('abort', onAbort)
      subscribers.delete(sub)
    }
    const onAbort = () => { void close() }
    params.signal?.addEventListener?.('abort', onAbort, { once: true })
    return { close }
  }

  async function close() {
    subscribers.clear()
    await client?.stop?.().catch(() => {})
    if (client) await dropSlot(enginePool, slotName).catch(() => {})
    client = null
    starting = null
    if (ownPool) await enginePool.end().catch(() => {})
  }

  return { subscribe, close }
}
