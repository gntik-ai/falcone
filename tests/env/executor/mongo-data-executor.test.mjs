// Real-Mongo proof for change add-mongo-data-execute.
// The Mongo data-API adapter builds command plans (filter/projection/sort, tenant-injected)
// but never executed them; this proves the executor runs them via the real driver, tenant-scoped.
// Run via tests/env/executor/run-mongo.sh (brings up the tests/env Mongo replica set).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import { createMongoExecutor } from '../../../apps/control-plane/src/runtime/mongo-data-executor.mjs'

const URI = process.env.MONGO_URI ?? 'mongodb://localhost:57017/?replicaSet=rs0&directConnection=true'
const DB = 'cp_mongo_probe'
const COLL = 'notes'
const TEN_A = 'ten_m_a'
const WS_A = 'ws_m_a'
const TEN_B = 'ten_m_b'
const WS_B = 'ws_m_b'

let admin // raw client for setup/cleanup/assertions
let exec

const idA = (t) => ({ tenantId: TEN_A, workspaceId: WS_A, roleName: t })
const base = (identity) => ({ databaseName: DB, collectionName: COLL, identity })

before(async () => {
  admin = new MongoClient(URI)
  await admin.connect()
  await admin.db(DB).dropDatabase().catch(() => {})
  exec = createMongoExecutor({ resolveUri: () => URI })
})

after(async () => {
  await exec?.close().catch(() => {})
  await admin?.db(DB).dropDatabase().catch(() => {})
  await admin?.close().catch(() => {})
})

test('insert injects the verified tenant; a forged tenant is rejected', async () => {
  // clean insert (no tenantId in payload) → adapter injects it from identity
  const res = await exec.executeMongoData({
    ...base({ tenantId: TEN_A, workspaceId: WS_A }),
    operation: 'insert',
    payload: { document: { _id: 'a1', body: 'a-one' } }
  })
  assert.equal(res.item.tenantId, TEN_A, 'tenant injected from identity')

  // forging a different tenant in the document is rejected (stronger than stamping)
  await assert.rejects(
    () => exec.executeMongoData({
      ...base({ tenantId: TEN_A, workspaceId: WS_A }),
      operation: 'insert', payload: { document: { _id: 'evil', body: 'x', tenantId: TEN_B } }
    }),
    (e) => e.statusCode === 403
  )

  await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'insert', payload: { document: { _id: 'a2', body: 'a-two' } } })
  await exec.executeMongoData({ ...base({ tenantId: TEN_B, workspaceId: WS_B }), operation: 'insert', payload: { document: { _id: 'b1', body: 'b-one' } } })
  assert.equal(await admin.db(DB).collection(COLL).countDocuments({}), 3, 'forged insert did not persist')
})

test('list returns ONLY the caller tenant documents', async () => {
  const a = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'list' })
  assert.equal(a.items.length, 2)
  assert.ok(a.items.every((d) => d.tenantId === TEN_A))

  const b = await exec.executeMongoData({ ...base({ tenantId: TEN_B, workspaceId: WS_B }), operation: 'list' })
  assert.equal(b.items.length, 1)
  assert.equal(b.items[0].tenantId, TEN_B)
})

test('list with a filter stays within tenant scope', async () => {
  const res = await exec.executeMongoData({
    ...base({ tenantId: TEN_A, workspaceId: WS_A }),
    operation: 'list',
    filter: { body: { $eq: 'a-one' } }
  })
  assert.equal(res.items.length, 1)
  assert.equal(res.items[0].body, 'a-one')
})

test('get by id is tenant-scoped (cross-tenant id → not found)', async () => {
  const own = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'get', documentId: 'a1' })
  assert.equal(own.found, true)
  assert.equal(own.item.body, 'a-one')

  const cross = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'get', documentId: 'b1' })
  assert.equal(cross.found, false, 'tenant A cannot read tenant B document by id')
})

test('update is tenant-scoped (cannot touch another tenant doc)', async () => {
  const cross = await exec.executeMongoData({
    ...base({ tenantId: TEN_A, workspaceId: WS_A }),
    operation: 'update', documentId: 'b1', payload: { update: { $set: { body: 'hacked' } } }
  })
  assert.equal(cross.matched, 0, 'no cross-tenant match')
  const own = await exec.executeMongoData({
    ...base({ tenantId: TEN_A, workspaceId: WS_A }),
    operation: 'update', documentId: 'a1', payload: { update: { $set: { body: 'a-one-edited' } } }
  })
  assert.equal(own.modified, 1)
})

test('delete is tenant-scoped', async () => {
  const cross = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'delete', documentId: 'b1' })
  assert.equal(cross.deleted, 0)
  const own = await exec.executeMongoData({ ...base({ tenantId: TEN_B, workspaceId: WS_B }), operation: 'delete', documentId: 'b1' })
  assert.equal(own.deleted, 1)
})

test('list supports keyset pagination via page.after (default _id sort)', async () => {
  for (const _id of ['pg1', 'pg2', 'pg3']) {
    await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'insert', payload: { document: { _id, body: 'page' } } })
  }
  const filter = { body: { $eq: 'page' } }

  // Page 1: 2 of the 3 marked docs + a next cursor.
  const p1 = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'list', filter, page: { size: 2 } })
  assert.equal(p1.items.length, 2)
  assert.ok(p1.items.every((d) => d.body === 'page'))
  assert.ok(typeof p1.page.after === 'string' && p1.page.after.length > 0, 'next cursor for a full page')

  // Page 2 via the cursor: the remaining doc, distinct from page 1, and no further cursor.
  const p2 = await exec.executeMongoData({ ...base({ tenantId: TEN_A, workspaceId: WS_A }), operation: 'list', filter, page: { size: 2, after: p1.page.after } })
  assert.equal(p2.items.length, 1)
  const ids1 = new Set(p1.items.map((d) => d._id))
  assert.ok(!ids1.has(p2.items[0]._id), 'page 2 does not repeat page 1')
  assert.equal(p2.page.after, undefined)
})

test('missing tenant identity → 401', async () => {
  await assert.rejects(
    () => exec.executeMongoData({ databaseName: DB, collectionName: COLL, identity: {}, operation: 'list' }),
    (e) => e.statusCode === 401
  )
})
