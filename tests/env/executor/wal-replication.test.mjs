// Real-stack proof for the logical-replication CDC path — change
// add-ferretdb-realtime-cdc-remediation (#460). FerretDB v2 has no change streams, so realtime SSE
// and the Kafka CDC bridge consume a Postgres logical replication slot (pgoutput) on the
// DocumentDB engine instead. This exercises the net-new WalReplicationClient + WalBsonDecoder +
// CollectionCatalog against the LIVE engine:
//   - writes insert/update/delete for two tenants through the FerretDB wire,
//   - asserts the decoded WAL records carry the full document (incl. tenantId), the UPDATE pre- and
//     post-images, and the DELETE pre-image (via REPLICA IDENTITY FULL),
//   - asserts a consumer-side `tenantId` filter cleanly isolates tenant A from tenant B.
//
// Run via tests/env/executor/run-wal.sh (brings up documentdb engine + ferretdb, engine-first).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import pg from 'pg'

import { WalReplicationClient } from '../../../services/mongo-cdc-bridge/src/WalReplicationClient.mjs'
import { CollectionCatalog } from '../../../services/mongo-cdc-bridge/src/CollectionCatalog.mjs'

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/'
const PG = {
  host: process.env.DOCUMENTDB_PG_HOST ?? 'localhost',
  port: Number(process.env.DOCUMENTDB_PG_PORT ?? 55433),
  user: process.env.DOCUMENTDB_PG_USER ?? 'falcone',
  password: process.env.DOCUMENTDB_PG_PASSWORD ?? 'falcone',
  database: process.env.DOCUMENTDB_PG_DATABASE ?? 'postgres'
}
const DB = 'cp_wal_probe'
const COLL = 'notes'
const PUBLICATION = 'falcone_cdc_pub'
const SLOT = 'falcone_cdc_test_slot'
const TEN_A = 'ten_wal_a'
const WS_A = 'ws_wal_a'
const TEN_B = 'ten_wal_b'
const WS_B = 'ws_wal_b'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

let mongo
let pool
let client
const changes = []

// Set REPLICA IDENTITY FULL on every existing documents_* table, (re)create the scoped publication,
// and (re)create a fresh pgoutput slot. Mirrors the engine/chart provisioning step (#460 tasks 2.x).
async function provision() {
  const { rows } = await pool.query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents_%' AND relkind = 'r'"
  )
  for (const r of rows) {
    await pool.query(`ALTER TABLE documentdb_data.${r.relname} REPLICA IDENTITY FULL`)
  }
  await pool.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
  await pool.query(`CREATE PUBLICATION ${PUBLICATION} FOR TABLES IN SCHEMA documentdb_data`)
  await pool.query(
    'SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1',
    [SLOT]
  )
  await pool.query("SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [SLOT])
}

async function writeDoc({ tenantId, workspaceId, _id, body }) {
  const c = mongo.db(DB).collection(COLL)
  await c.insertOne({ _id, tenantId, workspaceId, body })
  await c.updateOne({ _id }, { $set: { body: `${body}-edited` } })
  await c.deleteOne({ _id })
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(100)
  }
  return false
}

before(async () => {
  mongo = new MongoClient(MONGO_URI)
  await mongo.connect()
  await mongo.db(DB).dropDatabase().catch(() => {})
  // Materialize the documents_<id> table BEFORE provisioning so REPLICA IDENTITY FULL applies to it.
  await mongo.db(DB).collection(COLL).insertOne({ _id: '__seed__', tenantId: '__seed__' })
  await mongo.db(DB).collection(COLL).deleteOne({ _id: '__seed__' })

  pool = new pg.Pool(PG)
  await provision()

  const catalog = new CollectionCatalog(pool)
  client = new WalReplicationClient({
    connectionConfig: PG,
    slotName: SLOT,
    publicationName: PUBLICATION,
    catalog,
    autoAck: true
  })
  client.on('change', (rec) => changes.push(rec))
  client.on('error', (err) => { if (!/terminat/i.test(err.message)) console.error('wal error:', err.message) })
  await client.start()
  await delay(500) // let the replication connection establish
})

after(async () => {
  await client?.stop().catch(() => {})
  await pool?.query('SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1', [SLOT]).catch(() => {})
  await pool?.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`).catch(() => {})
  await pool?.end().catch(() => {})
  await mongo?.db(DB).dropDatabase().catch(() => {})
  await mongo?.close().catch(() => {})
})

test('WAL replication decodes insert/update/delete with full documents and tenantId', async () => {
  await writeDoc({ tenantId: TEN_A, workspaceId: WS_A, _id: 'wal-a1', body: 'alpha' })

  const got = await waitFor(() => changes.some((c) => c.documentId === 'wal-a1' && c.operationType === 'delete'))
  assert.ok(got, 'received the full insert→update→delete sequence for tenant A')

  const forA = changes.filter((c) => c.documentId === 'wal-a1')
  const ins = forA.find((c) => c.operationType === 'insert')
  const upd = forA.find((c) => c.operationType === 'update')
  const del = forA.find((c) => c.operationType === 'delete')

  assert.ok(ins, 'insert decoded')
  assert.equal(ins.tenantId, TEN_A)
  assert.equal(ins.database, DB)
  assert.equal(ins.collection, COLL)
  assert.equal(ins.fullDocument?.body, 'alpha')
  assert.equal(ins.fullDocument?.tenantId, TEN_A)
  assert.equal(ins.fullDocumentBeforeChange, null, 'insert has no pre-image')

  assert.ok(upd, 'update decoded')
  assert.equal(upd.fullDocument?.body, 'alpha-edited', 'update carries the new image')
  assert.equal(upd.fullDocumentBeforeChange?.body, 'alpha', 'update carries the pre-image (REPLICA IDENTITY FULL)')

  assert.ok(del, 'delete decoded')
  assert.equal(del.fullDocument, null, 'delete has no new image')
  assert.equal(del.fullDocumentBeforeChange?.tenantId, TEN_A, 'delete pre-image carries tenantId (tenant-scopable)')
  assert.ok(del.lsn && /^[0-9A-F]+\/[0-9A-F]+$/.test(del.lsn), 'change carries a usable LSN cursor')
})

test('consumer-side tenantId filter isolates tenant A from tenant B', async () => {
  changes.length = 0
  await writeDoc({ tenantId: TEN_A, workspaceId: WS_A, _id: 'wal-iso-a', body: 'a-secret' })
  await writeDoc({ tenantId: TEN_B, workspaceId: WS_B, _id: 'wal-iso-b', body: 'b-secret' })

  const got = await waitFor(() => changes.some((c) => c.documentId === 'wal-iso-b' && c.operationType === 'delete'))
  assert.ok(got, 'received both tenants\' change streams on the shared slot')

  // The slot delivers ALL tenants' rows; the consumer scopes by tenantId. A tenant-A consumer
  // must never observe a tenant-B document — on inserts/updates (fullDocument) or deletes (pre-image).
  const tenantOf = (c) => c.tenantId ?? c.fullDocument?.tenantId ?? c.fullDocumentBeforeChange?.tenantId
  const visibleToA = changes.filter((c) => tenantOf(c) === TEN_A)
  assert.ok(visibleToA.length >= 3, 'tenant A sees its own insert/update/delete')
  assert.ok(visibleToA.every((c) => c.documentId !== 'wal-iso-b'), 'tenant A never sees tenant B documents')
  assert.ok(
    changes.some((c) => c.documentId === 'wal-iso-b'),
    'tenant B changes are present on the slot (proving the filter — not absence — is what isolates)'
  )
})
