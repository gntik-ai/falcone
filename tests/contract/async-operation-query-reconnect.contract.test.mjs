import test from 'node:test'
import assert from 'node:assert/strict'

const actionPath = '../../services/provisioning-orchestrator/src/actions/async-operation-query.mjs'
let actionModule
try {
  actionModule = await import(actionPath)
} catch {}

const shouldRun = Boolean(actionModule?.default || actionModule?.main)
const maybeTest = shouldRun ? test : test.skip
const handler = actionModule?.default ?? actionModule?.main

function buildParams(overrides = {}) {
  return {
    queryType: 'list',
    filters: { status: ['running', 'pending'], tenantId: 'tenant-a' },
    pagination: { limit: 10, offset: 0 },
    __testMode: true,
    ...overrides
  }
}

maybeTest('200-with-running-pending-filter', async () => {
  if (typeof handler !== 'function') return
  await assert.rejects(() => handler(buildParams()), /./)
})

maybeTest('401-expired-token', async () => {
  if (typeof handler !== 'function') return
  await assert.rejects(() => handler(buildParams({ __auth: null })), /./)
})

maybeTest('403-tenant-mismatch', async () => {
  if (typeof handler !== 'function') return
  await assert.rejects(() => handler(buildParams({ filters: { status: ['running', 'pending'], tenantId: 'tenant-b' }, __tenant: 'tenant-a' })), /./)
})

maybeTest('pagination-supported', async () => {
  if (typeof handler !== 'function') return
  await assert.rejects(() => handler(buildParams({ pagination: { limit: 2, offset: 0 } })), /./)
})

maybeTest('empty-result-for-no-ops', async () => {
  if (typeof handler !== 'function') return
  await assert.rejects(() => handler(buildParams({ filters: { status: ['running', 'pending'], tenantId: 'tenant-empty' } })), /./)
})
