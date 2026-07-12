// Real-Postgres proof for the Postgres realtime executor (change: add-realtime-postgres-cdc).
// A trigger + LISTEN/NOTIFY captures table changes onto a per-tenant channel; this proves a
// subscriber receives ONLY its tenant's insert/update/delete and never another tenant's.
// Run via tests/env/executor/run.sh (tests/env Postgres).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
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
