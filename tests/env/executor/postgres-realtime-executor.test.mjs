// Real-Postgres proof for the Postgres realtime executor (change: add-realtime-postgres-cdc).
// A trigger + LISTEN/NOTIFY captures table changes onto a per-tenant channel; this proves a
// subscriber receives ONLY its tenant's insert/update/delete and never another tenant's.
// Run via tests/env/executor/run.sh (tests/env Postgres).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { createPostgresRealtimeExecutor } from '../../../apps/control-plane-executor/src/runtime/postgres-realtime-executor.mjs'
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs'
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs'
import { createApiKeyStore } from '../../../apps/control-plane-executor/src/runtime/api-keys.mjs'

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
  realtime = createPostgresRealtimeExecutor({ resolveConnection: () => ({ dsn }) })
})

after(async () => {
  await realtime?.close().catch(() => {})
  await admin?.end().catch(() => {})
  if (bootstrap) {
    // Plain (non-FORCE) drop — pools are already ended; FORCE could kill a still-closing
    // local connection, which node:test flags as async-after-teardown. Residue is cleaned by
    // the next run's before() FORCE-drop (fresh process, no live local connection).
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {})
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

test('HTTP anon table stream enforces SELECT before capture DDL and emits insert/update/delete', async () => {
  const role = `rt_app_${randomBytes(8).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  await admin.query(`DO $$ BEGIN CREATE ROLE falcone_anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`)
  await admin.query('CREATE TABLE public.http_notes (id text PRIMARY KEY, tenant_id text, body text)')
  await admin.query('GRANT SELECT ON public.http_notes TO falcone_anon')
  await admin.query('CREATE TABLE public.denied_notes (id text PRIMARY KEY, tenant_id text)')
  const appUrl = new URL(dsn)
  appUrl.username = role
  appUrl.password = password
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appUrl.toString() }) })
  const keys = createApiKeyStore({ pool: admin })
  await keys.ensureSchema()
  const { key } = await keys.issueKey({ tenantId: TEN_A, workspaceId: 'ws-a', keyType: 'anon' })
  const server = createControlPlaneServer({ registry, apiKeyStore: keys, pgRealtimeExecutor: realtime, logger: { error() {} } })
  const controller = new AbortController()
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const base = `http://127.0.0.1:${server.address().port}/v1/realtime/workspaces/ws-a/data/${PROBE_DB}/schemas/public/tables/`
    const before = await admin.query("SELECT oid FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid")
    for (const [name, status, code] of [['denied_notes', 403, 'FORBIDDEN'], ['bad-table', 400, 'INVALID_IDENTIFIER']]) {
      const response = await fetch(`${base}${name}/changes?apikey=${key}`)
      assert.equal(response.status, status)
      assert.equal((await response.json()).code, code)
    }
    assert.deepEqual((await admin.query("SELECT oid FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid")).rows, before.rows, 'denied subscriptions create no capture trigger')
    const response = await fetch(`${base}http_notes/changes?apikey=${key}`, { signal: controller.signal })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    await delay(300)
    await admin.query("INSERT INTO public.http_notes VALUES ('http-row', $1, 'one')", [TEN_A])
    await admin.query("UPDATE public.http_notes SET body='two' WHERE id='http-row'")
    await admin.query("DELETE FROM public.http_notes WHERE id='http-row'")
    const reader = response.body.getReader()
    let text = ''
    const decoder = new TextDecoder()
    while (!text.includes('event: delete')) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
    assert.deepEqual([...text.matchAll(/event: (\w+)/g)].map((match) => match[1]), ['insert', 'update', 'delete'])
    const events = [...text.matchAll(/data: (.+)\n/g)].map((match) => JSON.parse(match[1]))
    assert.ok(events.every((event) => event.documentId === 'http-row' && event.document.tenant_id === TEN_A))
    assert.deepEqual(events.map((event) => event.document.body), ['one', 'two', 'two'])
    await reader.cancel()
  } finally {
    controller.abort()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await registry.end()
    await admin.query(`DROP ROLE "${role}"`)
  }
})
