// Black-box tests for change fix-realtime-cdc-startup-and-workspace-scope (#688).
//
// Pure-unit proof (no live engine) that the realtime executor's consumer-side dispatch is scoped by
// tenant AND workspace: two workspaces of the SAME tenant sharing the same database+collection name
// must NOT cross-receive WAL change events. The real-stack equivalent lives in
// tests/env/executor/realtime-executor.test.mjs (engine-gated); this drives the dispatch path with a
// synthetic 'change' emission via the injectable clientFactory seam.
//
// bbx-688-01: a change in workspace A is delivered only to workspace A's subscriber, not workspace B's
//             (same tenant, same db+collection).
// bbx-688-02: a cross-TENANT change is still discarded (the pre-existing tenant guard is not weakened).
// bbx-688-03: a change for a different db/collection is not delivered.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createRealtimeExecutor } from '../../apps/control-plane-executor/src/runtime/realtime-executor.mjs'

// Fake pg pool: answers the executor's provisioning reads (publication exists, no documents_* tables)
// and resolves slot create/drop, so ensureStarted() completes without a real engine.
function fakePool() {
  return {
    async query(sql) {
      if (/FROM pg_publication/.test(sql)) return { rows: [{ '?column?': 1 }] }
      if (/documentdb_data/.test(sql) && /pg_class/.test(sql)) return { rows: [] }
      return { rows: [] } // slot create/drop, etc.
    },
    async end() {}
  }
}

// Fake WAL replication client: an EventEmitter the test drives by emitting synthetic 'change' records.
// Mirrors the surface the executor uses (on/emit/start/stop).
function fakeClientFactory() {
  let made
  const factory = () => {
    made = new EventEmitter()
    made.start = async () => {}
    made.stop = async () => {}
    return made
  }
  factory.client = () => made
  return factory
}

const change = (over = {}) => ({
  operationType: 'insert',
  database: 'd',
  collection: 'c',
  collectionId: 1,
  tenantId: 'ten_a',
  workspaceId: 'ws_a',
  documentId: 'doc-1',
  fullDocument: { _id: 'doc-1', tenantId: 'ten_a', workspaceId: 'ws_a' },
  fullDocumentBeforeChange: null,
  ...over
})

async function withExecutor(run) {
  const clientFactory = fakeClientFactory()
  const exec = createRealtimeExecutor({
    engineConnectionConfig: { connectionString: 'postgres://u:p@h:5432/db' },
    enginePool: fakePool(),
    catalog: { resolve: async () => ({ databaseName: 'd', collectionName: 'c' }) },
    clientFactory,
    slotName: 'falcone_rt_test'
  })
  try {
    await run(exec, () => clientFactory.client())
  } finally {
    await exec.close().catch(() => {})
  }
}

test('bbx-688-01: same tenant, two workspaces sharing db+collection — change in ws_a reaches only ws_a', async () => {
  await withExecutor(async (exec, client) => {
    const a = []
    const b = []
    await exec.subscribe({ workspaceId: 'ws_a', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_a' }, onChange: (e) => a.push(e) })
    await exec.subscribe({ workspaceId: 'ws_b', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_b' }, onChange: (e) => b.push(e) })

    // A WAL change written in workspace A (same tenant, same db+collection as B).
    client().emit('change', change({ workspaceId: 'ws_a', documentId: 'doc-a', fullDocument: { _id: 'doc-a', tenantId: 'ten_a', workspaceId: 'ws_a' } }))

    assert.equal(a.length, 1, "workspace A's subscriber receives its own change")
    assert.equal(a[0].documentId, 'doc-a')
    assert.equal(b.length, 0, "workspace B's subscriber does NOT receive workspace A's change")
  })
})

test('bbx-688-01b: a change in ws_b reaches only ws_b (symmetric)', async () => {
  await withExecutor(async (exec, client) => {
    const a = []
    const b = []
    await exec.subscribe({ workspaceId: 'ws_a', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_a' }, onChange: (e) => a.push(e) })
    await exec.subscribe({ workspaceId: 'ws_b', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_b' }, onChange: (e) => b.push(e) })

    client().emit('change', change({ workspaceId: 'ws_b', documentId: 'doc-b', fullDocument: { _id: 'doc-b', tenantId: 'ten_a', workspaceId: 'ws_b' } }))

    assert.equal(b.length, 1, "workspace B's subscriber receives its own change")
    assert.equal(a.length, 0, "workspace A's subscriber does NOT receive workspace B's change")
  })
})

test('bbx-688-02: cross-tenant change is still discarded (tenant guard not weakened)', async () => {
  await withExecutor(async (exec, client) => {
    const a = []
    await exec.subscribe({ workspaceId: 'ws_a', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_a' }, onChange: (e) => a.push(e) })

    // Same workspace id string, but a DIFFERENT tenant — must never be delivered.
    client().emit('change', change({ tenantId: 'ten_b', workspaceId: 'ws_a', documentId: 'doc-x', fullDocument: { _id: 'doc-x', tenantId: 'ten_b', workspaceId: 'ws_a' } }))

    assert.equal(a.length, 0, "tenant A's subscriber receives no tenant B change")
  })
})

test('bbx-688-03: matching tenant+workspace but different collection is not delivered', async () => {
  await withExecutor(async (exec, client) => {
    const a = []
    await exec.subscribe({ workspaceId: 'ws_a', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_a' }, onChange: (e) => a.push(e) })

    client().emit('change', change({ collection: 'other', documentId: 'doc-y', fullDocument: { _id: 'doc-y', tenantId: 'ten_a', workspaceId: 'ws_a' } }))

    assert.equal(a.length, 0, 'a change for a different collection is not delivered')
  })
})

test('bbx-688-04: matching tenant+workspace+db+collection IS delivered', async () => {
  await withExecutor(async (exec, client) => {
    const a = []
    await exec.subscribe({ workspaceId: 'ws_a', databaseName: 'd', collectionName: 'c', identity: { tenantId: 'ten_a', workspaceId: 'ws_a' }, onChange: (e) => a.push(e) })

    client().emit('change', change())

    assert.equal(a.length, 1, 'a fully-matching change is delivered')
    assert.equal(a[0].type, 'insert')
    assert.equal(a[0].documentId, 'doc-1')
  })
})
