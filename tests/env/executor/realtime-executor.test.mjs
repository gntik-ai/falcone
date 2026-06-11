// Real-Mongo proof for the realtime executor (change: add-realtime-changestream).
// Opens a tenant-scoped change stream and asserts: the caller's inserts/updates arrive,
// and ANOTHER tenant's writes never reach this subscriber (tenant isolation in the pipeline).
// Run via tests/env/executor/run-mongo.sh (single-node replica set rs0 — change streams need it).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import { createMongoExecutor } from '../../../apps/control-plane/src/runtime/mongo-data-executor.mjs'
import { createRealtimeExecutor } from '../../../apps/control-plane/src/runtime/realtime-executor.mjs'

const URI = process.env.MONGO_URI ?? 'mongodb://localhost:57017/?replicaSet=rs0&directConnection=true'
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
  dataExec = createMongoExecutor({ resolveUri: () => URI })
  realtime = createRealtimeExecutor({ resolveUri: () => URI })
})

after(async () => {
  await realtime?.close().catch(() => {})
  await dataExec?.close().catch(() => {})
  await admin?.db(DB).dropDatabase().catch(() => {})
  await admin?.close().catch(() => {})
})

test('a tenant-scoped change stream delivers the caller tenant inserts and NOT another tenant', async () => {
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
  await delay(300) // let the change stream establish before writing

  // tenant A insert → should arrive
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_A }, operation: 'insert', payload: { document: { _id: 'rt-a1', body: 'a-one' } } })
  // tenant B insert → must NOT arrive on tenant A's subscriber
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_B, workspaceId: WS_B }, operation: 'insert', payload: { document: { _id: 'rt-b1', body: 'b-one' } } })
  // tenant A update → should arrive
  await dataExec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: { tenantId: TEN_A, workspaceId: WS_A }, operation: 'update', documentId: 'rt-a1', payload: { update: { $set: { body: 'a-one-edited' } } } })

  await delay(700) // let change events flush
  controller.abort()
  await sub.close()

  const ids = events.map((e) => e.documentId)
  assert.ok(ids.includes('rt-a1'), 'tenant A insert delivered')
  assert.ok(!ids.includes('rt-b1'), 'tenant B insert must NOT reach tenant A subscriber')
  assert.ok(events.every((e) => e.document?.tenantId === TEN_A), 'every delivered doc is tenant A')
  assert.ok(events.some((e) => e.type === 'update' && e.document?.body === 'a-one-edited'), 'update delivered with fullDocument')
})

test('subscribe without tenant identity → 401', async () => {
  await assert.rejects(
    () => realtime.subscribe({ workspaceId: WS_A, databaseName: DB, collectionName: COLL, identity: {}, onChange() {} }),
    (e) => e.statusCode === 401
  )
})
