// Real-stack proof for the realtime SSE executor over logical replication — change
// add-ferretdb-realtime-cdc-remediation (#460). FerretDB v2 has no change streams, so the executor
// consumes a pgoutput slot on the DocumentDB engine and fans WAL changes out to per-session
// subscribers. Writes go through the FerretDB wire (the data executor); the realtime executor reads
// them back off the engine's WAL. Asserts the caller tenant's inserts/updates/deletes arrive (a WAL
// UPDATE surfaces as 'replace'), ANOTHER tenant's writes never reach this subscriber, and the delete
// carries the pre-image (so it is tenant-scoped via REPLICA IDENTITY FULL).
//
// Run via tests/env/executor/run-realtime.sh (FerretDB gateway + DocumentDB engine, engine-first).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'

import { createMongoExecutor } from '../../../apps/control-plane-executor/src/runtime/mongo-data-executor.mjs'
import { createRealtimeExecutor } from '../../../apps/control-plane-executor/src/runtime/realtime-executor.mjs'

const URI = process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/'
const PG = {
  host: process.env.DOCUMENTDB_PG_HOST ?? 'localhost',
  port: Number(process.env.DOCUMENTDB_PG_PORT ?? 55433),
  user: process.env.DOCUMENTDB_PG_USER ?? 'falcone',
  password: process.env.DOCUMENTDB_PG_PASSWORD ?? 'falcone',
  database: process.env.DOCUMENTDB_PG_DATABASE ?? 'postgres'
}
const DB = 'cp_realtime_probe'
const COLL = 'notes'
const TEN_A = 'ten_rt_a'
const WS_A = 'ws_rt_a'
const TEN_B = 'ten_rt_b'
const WS_B = 'ws_rt_b'

let admin
let dataExec
let realtime

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  admin = new MongoClient(URI)
  await admin.connect()
  await admin.db(DB).dropDatabase().catch(() => {})
  await admin.db(DB).createCollection(COLL).catch(() => {})
  // Materialize documents_<id> so the executor's REPLICA IDENTITY FULL sweep covers it before the slot.
  await admin.db(DB).collection(COLL).insertOne({ _id: '__seed__', tenantId: '__seed__' })
  await admin.db(DB).collection(COLL).deleteOne({ _id: '__seed__' })

  dataExec = createMongoExecutor({ resolveUri: () => URI })
  realtime = createRealtimeExecutor({ engineConnectionConfig: PG, slotName: 'falcone_rt_test' })
})

after(async () => {
  await realtime?.close().catch(() => {})
  await dataExec?.close().catch(() => {})
  await admin?.db(DB).dropDatabase().catch(() => {})
  await admin?.close().catch(() => {})
})

test('a tenant-scoped WAL subscription delivers the caller tenant changes and NOT another tenant', async () => {
  const events = []
  const controller = new AbortController()
  const sub = await realtime.subscribe({
    workspaceId: WS_A,
    databaseName: DB,
    collectionName: COLL,
    identity: { tenantId: TEN_A, workspaceId: WS_A },
    signal: controller.signal,
    onChange: (event) => events.push(event)
  })
  await delay(600) // let the replication connection establish before writing

  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_A }, operation: 'insert', payload: { document: { _id: 'rt-a1', body: 'a-one' } } })
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_B, workspaceId: WS_B }, operation: 'insert', payload: { document: { _id: 'rt-b1', body: 'b-one' } } })
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_A }, operation: 'update', documentId: 'rt-a1', payload: { update: { $set: { body: 'a-one-edited' } } } })
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_A }, operation: 'delete', documentId: 'rt-a1' })
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_B, workspaceId: WS_B }, operation: 'delete', documentId: 'rt-b1' })

  // wait for the delete (last event) to flow through the slot
  const deadline = Date.now() + 8000
  while (Date.now() < deadline && !events.some((e) => e.type === 'delete')) await delay(150)
  controller.abort()
  await sub.close()

  const ids = events.map((e) => e.documentId)
  assert.ok(ids.includes('rt-a1'), 'tenant A insert delivered')
  assert.ok(!ids.includes('rt-b1'), 'no tenant B change (insert or delete) reaches tenant A subscriber')
  assert.ok(events.every((e) => e.document == null || e.document.tenantId === TEN_A), 'every delivered doc is tenant A')
  // A WAL UPDATE surfaces as 'replace' (logical replication carries the full new image).
  assert.ok(events.some((e) => e.type === 'replace' && e.document?.body === 'a-one-edited'), 'update delivered as replace with full document')
  const del = events.find((e) => e.type === 'delete')
  assert.ok(del, 'tenant A delete delivered (pre-image keeps it tenant-scoped)')
  assert.equal(del.documentId, 'rt-a1')
  assert.equal(del.document?.tenantId, TEN_A, 'delete carries the prior tenant-A document')
})

test('two workspaces of the SAME tenant sharing db+collection do not cross-receive changes (#688)', async () => {
  // Same tenant, same database, same collection name — only the workspaceId differs. A change
  // written in workspace B must NOT reach workspace A's subscriber (and vice-versa).
  const WS_1 = 'ws_rt_same_1'
  const WS_2 = 'ws_rt_same_2'
  const eventsW1 = []
  const eventsW2 = []
  const c1 = new AbortController()
  const c2 = new AbortController()
  const sub1 = await realtime.subscribe({
    workspaceId: WS_1, databaseName: DB, collectionName: COLL,
    identity: { tenantId: TEN_A, workspaceId: WS_1 }, signal: c1.signal,
    onChange: (e) => eventsW1.push(e)
  })
  const sub2 = await realtime.subscribe({
    workspaceId: WS_2, databaseName: DB, collectionName: COLL,
    identity: { tenantId: TEN_A, workspaceId: WS_2 }, signal: c2.signal,
    onChange: (e) => eventsW2.push(e)
  })
  await delay(600)

  // One write in each workspace (same tenant, same db+collection).
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_1 }, operation: 'insert', payload: { document: { _id: 'rt-w1', body: 'w-one' } } })
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_2 }, operation: 'insert', payload: { document: { _id: 'rt-w2', body: 'w-two' } } })

  const deadline = Date.now() + 8000
  while (Date.now() < deadline && !(eventsW1.some((e) => e.documentId === 'rt-w1') && eventsW2.some((e) => e.documentId === 'rt-w2'))) await delay(150)
  c1.abort(); c2.abort()
  await sub1.close(); await sub2.close()

  const ids1 = eventsW1.map((e) => e.documentId)
  const ids2 = eventsW2.map((e) => e.documentId)
  assert.ok(ids1.includes('rt-w1'), 'workspace 1 subscriber receives its own change')
  assert.ok(!ids1.includes('rt-w2'), 'workspace 1 subscriber does NOT receive workspace 2 change')
  assert.ok(ids2.includes('rt-w2'), 'workspace 2 subscriber receives its own change')
  assert.ok(!ids2.includes('rt-w1'), 'workspace 2 subscriber does NOT receive workspace 1 change')
})

test('subscribe without tenant identity → 401', async () => {
  await assert.rejects(
    () => realtime.subscribe({ workspaceId: WS_A, databaseName: DB, collectionName: COLL, identity: {}, onChange() {} }),
    (e) => e.statusCode === 401
  )
})
