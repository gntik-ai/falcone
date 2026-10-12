// Real-Postgres proof for the Postgres realtime executor (change: add-realtime-postgres-cdc).
// A trigger + LISTEN/NOTIFY captures table changes onto a per-tenant channel; this proves a
// subscriber receives ONLY its tenant's insert/update/delete and never another tenant's.
// Run via tests/env/executor/run.sh (tests/env Postgres).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createApiKeyStore } from '../../../apps/control-plane-executor/src/runtime/api-keys.mjs'
import { realtimeRequest } from '../../unit/helpers/realtime-http.mjs'
import { createPostgresRealtimeExecutor } from '../../../apps/control-plane-executor/src/runtime/postgres-realtime-executor.mjs'

const { Pool } = pg

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`

const PROBE_DB = 'cp_rt_probe'
const TEN_A = 'ten_rt_a'
const TEN_B = 'ten_rt_b'

let bootstrap
let admin
let realtime
let dsn
let keys
let anonKey
let secondKey
let secondAdmin

const probeUrl = () => ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 })
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`)
  dsn = probeUrl()
  admin = new Pool({ connectionString: dsn, max: 2 })
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await admin.query(`CREATE TABLE public.notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL, body text NOT NULL)`)
  await admin.query("DO $$ BEGIN CREATE ROLE falcone_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
  await admin.query('GRANT USAGE ON SCHEMA public TO falcone_anon')
  await admin.query('GRANT SELECT ON public.notes TO falcone_anon')
  await admin.query('CREATE TABLE public.denied (id text, tenant_id text)')
  await admin.query('REVOKE ALL ON public.denied FROM falcone_anon, PUBLIC')
  await admin.query('CREATE TABLE public.protected (id text, tenant_id text)')
  await admin.query('GRANT SELECT ON public.protected TO falcone_anon')
  await admin.query('ALTER TABLE public.protected ENABLE ROW LEVEL SECURITY')
  await admin.query('CREATE SCHEMA private')
  await admin.query('CREATE TABLE private.notes (id text, tenant_id text)')
  await admin.query('GRANT SELECT ON private.notes TO falcone_anon')
  await admin.query('REVOKE USAGE ON SCHEMA private FROM falcone_anon, PUBLIC')
  keys = createApiKeyStore({ pool: admin })
  await keys.ensureSchema()
  anonKey = (await keys.issueKey({ tenantId: TEN_A, workspaceId: 'ws-a' })).key
  secondKey = (await keys.issueKey({ tenantId: TEN_A, workspaceId: 'ws-a2' })).key
  await bootstrap.query(`DROP DATABASE IF EXISTS cp_rt_probe_2 WITH (FORCE)`)
  await bootstrap.query(`CREATE DATABASE cp_rt_probe_2`)
  const secondDsn = ADMIN_URL.replace(/\/[^/]+$/, '/cp_rt_probe_2')
  secondAdmin = new Pool({ connectionString: secondDsn, max: 2 })
  await secondAdmin.query('CREATE TABLE public.notes (id text PRIMARY KEY, tenant_id text NOT NULL, body text NOT NULL)')
  await secondAdmin.query('GRANT USAGE ON SCHEMA public TO falcone_anon')
  await secondAdmin.query('GRANT SELECT ON public.notes TO falcone_anon')
  realtime = createPostgresRealtimeExecutor({ resolveConnection: workspaceId => ({ dsn: workspaceId === 'ws-a2' ? secondDsn : dsn, routed: true }) })
})

after(async () => {
  await realtime?.close().catch(() => {})
  await admin?.end().catch(() => {})
  await secondAdmin?.end().catch(() => {})
  if (bootstrap) {
    // Plain (non-FORCE) drop — pools are already ended; FORCE could kill a still-closing
    // local connection, which node:test flags as async-after-teardown. Residue is cleaned by
    // the next run's before() FORCE-drop (fresh process, no live local connection).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {})
    await bootstrap.query('DROP DATABASE IF EXISTS cp_rt_probe_2').catch(() => {})
    await bootstrap.end().catch(() => {})
  }
})

test('a tenant-scoped change capture delivers the caller tenant changes and NOT another tenant', async () => {
  const events = []
  const controller = new AbortController()
  await realtime.subscribe({
    workspaceId: 'ws-a',
    databaseName: PROBE_DB,
    schemaName: 'public',
    tableName: 'notes',
    identity: { tenantId: TEN_A, workspaceId: 'ws-a' },
    signal: controller.signal,
    onChange: (event) => events.push(event)
  })
  await delay(300) // let LISTEN + trigger settle

  // tenant A insert → delivered; tenant B insert → NOT delivered to A's channel
  const a = await admin.query(`INSERT INTO public.notes (tenant_id, body) VALUES ($1,'a-one') RETURNING id`, [TEN_A])
  const aId = a.rows[0].id
  await admin.query(`INSERT INTO public.notes (tenant_id, body) VALUES ($1,'b-one')`, [TEN_B])
  await admin.query(`UPDATE public.notes SET body='a-one-edited' WHERE id=$1`, [aId])
  await admin.query(`DELETE FROM public.notes WHERE id=$1`, [aId])

  await delay(700) // let notifications flush
  controller.abort()

  const types = events.map((e) => e.type)
  assert.ok(types.includes('insert'), 'tenant A insert delivered')
  assert.ok(types.includes('update'), 'tenant A update delivered')
  assert.ok(types.includes('delete'), 'tenant A delete delivered (OLD.tenant_id keeps it scoped)')
  assert.ok(events.every((e) => e.document == null || e.document.tenant_id === TEN_A), 'every delivered row is tenant A')
  assert.ok(!events.some((e) => e.document?.body === 'b-one'), 'tenant B change must NOT reach tenant A subscriber')
  const insert = events.find((e) => e.type === 'insert')
  assert.equal(insert.document.body, 'a-one', 'insert carries the new row')
})

test('subscribe without tenant identity → 401', async () => {
  await assert.rejects(
    () => realtime.subscribe({ workspaceId: 'ws-a', databaseName: PROBE_DB, schemaName: 'public', tableName: 'notes', identity: {}, onChange() {} }),
    (e) => e.statusCode === 401
  )
})

const streamPath = (workspace, schema = 'public', table = 'notes') =>
  `/v1/realtime/workspaces/${workspace}/data/app/schemas/${schema}/tables/${table}/changes`
const frames = response => [...response.body.matchAll(/event: (\w+)\ndata: ([^\n]+)\n\n/g)]
  .map(match => ({ event: match[1], data: JSON.parse(match[2]) }))

test('real catalog denials are JSON before streaming and do not create or replace capture objects', async () => {
  const functions = () => admin.query("SELECT oid, xmin::text FROM pg_proc WHERE proname = 'flc_realtime_notify'")
  const before = (await functions()).rows
  for (const [schema, table, status] of [
    ['public', 'missing', 404], ['public', 'denied', 403], ['public', 'protected', 403],
    ['private', 'notes', 403], ['public', 'notes%22', 404], ['public', 'notes%2522', 404],
  ]) {
    const response = await realtimeRequest({ apiKeyStore: keys, pgRealtimeExecutor: realtime }, `${streamPath('ws-a', schema, table)}?apikey=${anonKey}`)
    try {
      assert.equal(response.res.statusCode, status)
      assert.match(response.res.headers['content-type'], /application\/json/)
      assert.equal(JSON.parse(response.body).code, status === 404 ? 'NOT_FOUND' : 'FORBIDDEN')
      assert.ok(!response.body.includes('event:'))
      const triggers = await admin.query(`SELECT t.oid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND t.tgname='flc_realtime_trg'`, [schema, table])
      assert.deepEqual(triggers.rows, [])
      assert.deepEqual((await functions()).rows, before)
    } finally { response.close() }
  }
})

test('query-key table SSE emits insert/update/delete and isolates workspaces of the same tenant', async () => {
  const a = await realtimeRequest({ apiKeyStore: keys, pgRealtimeExecutor: realtime }, `${streamPath('ws-a')}?apikey=${anonKey}`)
  const a2 = await realtimeRequest({ apiKeyStore: keys, pgRealtimeExecutor: realtime }, `${streamPath('ws-a2')}?apikey=${secondKey}`)
  try {
    assert.equal(a.res.statusCode, 200)
    assert.equal(a.res.headers['content-type'], 'text/event-stream')
    assert.equal(a2.res.statusCode, 200)
    await delay(600)
    const inserted = await admin.query("INSERT INTO public.notes (tenant_id, body) VALUES ($1, 'sse-first') RETURNING id", [TEN_A])
    const id = inserted.rows[0].id
    await admin.query("UPDATE public.notes SET body='sse-edited' WHERE id=$1", [id])
    await admin.query('DELETE FROM public.notes WHERE id=$1', [id])
    // A2 has the same tenant/schema/table but its own database and notification connection.
    await secondAdmin.query("INSERT INTO public.notes VALUES ('a2-row', $1, 'a2-only')", [TEN_A])
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && (frames(a).length < 3 || frames(a2).length < 1)) await delay(50)
    assert.deepEqual(frames(a).map(frame => frame.event), ['insert', 'update', 'delete'])
    assert.deepEqual(frames(a).map(frame => frame.data.type), ['insert', 'update', 'delete'])
    assert.ok(frames(a).every(frame => frame.data.documentId === id))
    assert.deepEqual(frames(a).map(frame => frame.data.document.body), ['sse-first', 'sse-edited', 'sse-edited'])
    assert.deepEqual(frames(a2).map(frame => frame.data.documentId), ['a2-row'])
  } finally { a.close(); a2.close() }
})
