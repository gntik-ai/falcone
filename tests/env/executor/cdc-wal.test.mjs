// Real-stack proof for the CDC bridge over logical replication — change
// add-ferretdb-realtime-cdc-remediation (#460). Drives the WHOLE CDC path against live
// infrastructure: a document written through the FerretDB wire → DocumentDB WAL → WalReplicationClient
// → ChangeStreamWatcher → MongoChangeEventMapper → real Kafka (redpanda). Asserts the CloudEvents
// envelopes for a tenant arrive on that tenant's topic, and that a second tenant's writes — present on
// the same slot — are NEVER published by a watcher scoped to the first tenant (cross-tenant isolation).
//
// Run via tests/env/executor/run-cdc-wal.sh (engine + redpanda; engine-first).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient } from 'mongodb'
import { Kafka } from 'kafkajs'
import pg from 'pg'

import { WalReplicationClient } from '../../../packages/mongo-cdc-bridge/src/WalReplicationClient.mjs'
import { CollectionCatalog } from '../../../packages/mongo-cdc-bridge/src/CollectionCatalog.mjs'
import { ChangeStreamWatcher } from '../../../packages/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs'
import { KafkaChangePublisher, deriveTopic } from '../../../packages/mongo-cdc-bridge/src/KafkaChangePublisher.mjs'

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/'
const BROKERS = (process.env.MONGO_CDC_KAFKA_BROKERS ?? 'localhost:19092').split(',')
const PG = {
  host: process.env.DOCUMENTDB_PG_HOST ?? 'localhost',
  port: Number(process.env.DOCUMENTDB_PG_PORT ?? 55433),
  user: process.env.DOCUMENTDB_PG_USER ?? 'falcone',
  password: process.env.DOCUMENTDB_PG_PASSWORD ?? 'falcone',
  database: process.env.DOCUMENTDB_PG_DATABASE ?? 'postgres'
}
const DB = 'cp_cdc_probe'
const COLL = 'orders'
const PUBLICATION = 'falcone_cdc_pub'
const SLOT = 'falcone_cdc_test_cdc_slot'
const A = { tenant_id: 'ten_cdc_a', workspace_id: 'ws_cdc_a' }
const B = { tenant_id: 'ten_cdc_b', workspace_id: 'ws_cdc_b' }
const captureConfig = { id: 'cfg-cdc-a', data_source_ref: 'ds-cdc', database_name: DB, collection_name: COLL, capture_mode: 'delta', ...A }

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (predicate, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (predicate()) return true; await delay(150) }
  return false
}

let mongo, pool, walClient, watcher, publisher, kafka, consumer
const upserts = []

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

  kafka = new Kafka({ clientId: 'cdc-wal-test', brokers: BROKERS })
  publisher = new KafkaChangePublisher({ kafka })
  await publisher.connect()

  walClient = new WalReplicationClient({ connectionConfig: PG, slotName: SLOT, publicationName: PUBLICATION, catalog: new CollectionCatalog(pool), autoAck: false })
  watcher = new ChangeStreamWatcher({
    captureConfig,
    walClient,
    kafkaPublisher: publisher,
    resumeTokenStore: { upsert: async (id, lsn) => { upserts.push([id, lsn]) } },
    statusUpdateCallback: async () => {}
  })
  await watcher.start()
  await delay(500)
})

after(async () => {
  await consumer?.disconnect().catch(() => {})
  await watcher?.stop().catch(() => {})
  await publisher?.disconnect().catch(() => {})
  await pool?.query('SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name = $1', [SLOT]).catch(() => {})
  await pool?.query(`DROP PUBLICATION IF EXISTS ${PUBLICATION}`).catch(() => {})
  await pool?.end().catch(() => {})
  await mongo?.db(DB).dropDatabase().catch(() => {})
  await mongo?.close().catch(() => {})
})

test('CDC bridge publishes a tenant\'s changes to Kafka and isolates a second tenant', async () => {
  const c = mongo.db(DB).collection(COLL)
  // Tenant A: insert → update → delete (the watcher is scoped to tenant A).
  await c.insertOne({ _id: 'ord-a', tenantId: A.tenant_id, workspaceId: A.workspace_id, total: 10 })
  await c.updateOne({ _id: 'ord-a' }, { $set: { total: 20 } })
  await c.deleteOne({ _id: 'ord-a' })
  // Tenant B: present on the SAME slot — must never be published by tenant A's watcher.
  await c.insertOne({ _id: 'ord-b', tenantId: B.tenant_id, workspaceId: B.workspace_id, total: 99 })
  await c.deleteOne({ _id: 'ord-b' })

  const published = await waitFor(() => upserts.length >= 3)
  assert.ok(published, `watcher published+persisted tenant A's 3 changes (got ${upserts.length})`)
  // Every persisted LSN is a real cursor; isolation means exactly 3 (B's 2 writes were filtered out).
  assert.equal(upserts.length, 3, 'only tenant A changes were published — tenant B was filtered on the slot')

  // Read tenant A's topic from the beginning and verify the CloudEvents envelopes.
  const events = []
  consumer = kafka.consumer({ groupId: `cdc-wal-test-${SLOT}` })
  await consumer.connect()
  await consumer.subscribe({ topic: deriveTopic({ tenantId: A.tenant_id, workspaceId: A.workspace_id }), fromBeginning: true })
  await consumer.run({ eachMessage: async ({ message }) => { events.push(JSON.parse(message.value.toString())) } })

  const got = await waitFor(() => events.some((e) => e.data.event_type === 'delete'))
  assert.ok(got, 'tenant A insert/update/delete CloudEvents arrived on tenant A topic')

  assert.ok(events.every((e) => e.tenantid === A.tenant_id), 'every event on tenant A topic is tenant A')
  assert.ok(events.every((e) => e.data.document_key._id !== 'ord-b'), 'no tenant B document ever reaches tenant A topic')

  const ins = events.find((e) => e.data.event_type === 'insert')
  const upd = events.find((e) => e.data.event_type === 'update')
  const del = events.find((e) => e.data.event_type === 'delete')
  assert.deepEqual(ins.data.full_document, { _id: 'ord-a', tenantId: A.tenant_id, workspaceId: A.workspace_id, total: 10 })
  assert.deepEqual(upd.data.update_description, { updatedFields: { total: 20 }, removedFields: [] }, 'delta update diff synthesised from WAL pre/post images')
  assert.deepEqual(del.data.document_key, { _id: 'ord-a' })
})
