// Real-stack restart-durability proof for the CDC bridge over logical replication — change
// add-ferretdb-realtime-cdc-remediation (#460), task 9.4. The slot's server-side confirmed LSN is
// the durable resume cursor (mirrored per capture config in ResumeTokenStore). This simulates a
// bridge restart mid-stream: a first consumer acknowledges only SOME changes, then stops; a second
// consumer on the SAME slot must resume from the last acknowledged LSN — redelivering the un-acked
// changes (no gap) and NEVER redelivering the acked ones (no duplicate).
//
// Run via tests/env/executor/run-cdc-resume.sh (documentdb engine + ferretdb gateway).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import pg from 'pg'

import { WalReplicationClient } from '../../../packages/mongo-cdc-bridge/src/WalReplicationClient.mjs'
import { CollectionCatalog } from '../../../packages/mongo-cdc-bridge/src/CollectionCatalog.mjs'

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/'
const PG = {
  host: process.env.DOCUMENTDB_PG_HOST ?? 'localhost',
  port: Number(process.env.DOCUMENTDB_PG_PORT ?? 55433),
  user: process.env.DOCUMENTDB_PG_USER ?? 'falcone',
  password: process.env.DOCUMENTDB_PG_PASSWORD ?? 'falcone',
  database: process.env.DOCUMENTDB_PG_DATABASE ?? 'postgres'
}
const DB = 'cp_resume_probe'
const COLL = 'events'
const PUBLICATION = 'falcone_cdc_pub'
const SLOT = 'falcone_cdc_resume_slot'
const TENANT = 'ten_resume'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (pred, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (pred()) return true; await delay(120) }
  return false
}

let mongo, pool

before(async () => {
  mongo = new MongoClient(MONGO_URI)
  await mongo.connect()
  await mongo.db(DB).dropDatabase().catch(() => {})
  await mongo.db(DB).collection(COLL).insertOne({ _id: '__seed__', tenantId: '__seed__' })
  await mongo.db(DB).collection(COLL).deleteOne({ _id: '__seed__' })

  pool = new pg.Pool(PG)
  const { rows } = await pool.query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents_%' AND relkind = 'r'"
  )
  for (const r of rows) await pool.query(`ALTER TABLE documentdb_data.${r.relname} REPLICA IDENTITY FULL`)
  await pool.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`)
  await pool.query(`CREATE PUBLICATION ${PUBLICATION} FOR TABLES IN SCHEMA documentdb_data`)
  await pool.query('SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1', [SLOT])
  await pool.query("SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [SLOT])
})

after(async () => {
  await pool?.query('SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1', [SLOT]).catch(() => {})
  await pool?.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`).catch(() => {})
  await pool?.end().catch(() => {})
  await mongo?.db(DB).dropDatabase().catch(() => {})
  await mongo?.close().catch(() => {})
})

function client(received, onRec) {
  const c = new WalReplicationClient({
    connectionConfig: PG, slotName: SLOT, publicationName: PUBLICATION,
    catalog: new CollectionCatalog(new pg.Pool(PG)), autoAck: false
  })
  c.onChange = async (rec) => { received.push(rec); if (onRec) await onRec(rec, c) }
  c.on('error', (err) => { if (!/terminat/i.test(err.message)) console.error('wal err:', err.message) })
  return c
}

test('CDC bridge resumes from the last acknowledged LSN: no duplicate of acked, no gap for un-acked', async () => {
  const c = mongo.db(DB).collection(COLL)
  await c.insertOne({ _id: 'r1', tenantId: TENANT, seq: 1 })
  await c.insertOne({ _id: 'r2', tenantId: TENANT, seq: 2 })
  await c.insertOne({ _id: 'r3', tenantId: TENANT, seq: 3 })

  // Consumer A: acknowledge ONLY r1, then stop (simulates a crash with r2/r3 unpublished).
  const a = []
  const clientA = client(a, async (rec, self) => { if (rec.documentId === 'r1') await self.acknowledge(rec.lsn) })
  await clientA.start()
  assert.ok(await waitFor(() => a.some((r) => r.documentId === 'r3')), 'consumer A saw all three inserts')
  await delay(300) // let the standby status for the r1 ack flush to the server
  await clientA.stop()

  // Consumer B: a fresh client on the SAME slot — resumes from the slot's confirmed LSN (after r1).
  const b = []
  const clientB = client(b)
  await clientB.start()
  await delay(400)
  await c.insertOne({ _id: 'r4', tenantId: TENANT, seq: 4 }) // a new change after restart
  assert.ok(await waitFor(() => b.some((r) => r.documentId === 'r4')), 'consumer B saw the post-restart insert')
  await clientB.stop()

  const idsB = b.map((r) => r.documentId)
  assert.ok(!idsB.includes('r1'), 'no DUPLICATE: the acknowledged r1 is not redelivered after restart')
  assert.ok(idsB.includes('r2') && idsB.includes('r3'), 'no GAP: the un-acknowledged r2 and r3 are redelivered')
  assert.ok(idsB.includes('r4'), 'the post-restart insert is delivered')
  // Order is preserved across the restart boundary.
  assert.deepEqual(idsB.filter((id) => ['r2', 'r3', 'r4'].includes(id)), ['r2', 'r3', 'r4'], 'redelivery is in-order')
})
