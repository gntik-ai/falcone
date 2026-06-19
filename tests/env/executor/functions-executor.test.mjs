// Proof for change add-functions-execute. Functions need a runtime; this exercises the LOCAL
// worker_threads backend (real isolated code execution + timeout), tenant-scoped. Pure node — no
// external service — so it runs directly: node --test (or via run-functions.sh). Production swaps
// the backend for Knative (deploy/kind/control-plane/function-executor.mjs).
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createFunctionsExecutor } from '../../../apps/control-plane/src/runtime/functions-executor.mjs'

const WS_A = 'wsfna'
const WS_B = 'wsfnb'
const idA = { tenantId: 'ten_fn_a', workspaceId: WS_A }
const idB = { tenantId: 'ten_fn_b', workspaceId: WS_B }

let exec

const SUM = "function main(params) { console.log('adding', params.a, params.b); return { sum: params.a + params.b } }"
const BOOM = 'function main() { throw new Error("kaboom") }'
const LOOP = 'function main() { while (true) {} }'

before(() => {
  exec = createFunctionsExecutor({ timeoutMs: 1000 }) // short timeout for the loop test
})

test('deploy then invoke runs the function and returns its result + logs', async () => {
  await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'deploy', name: 'sum', payload: { source: SUM } })
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'invoke', name: 'sum', payload: { a: 2, b: 3 } })
  assert.equal(res.status, 'success')
  assert.deepEqual(res.result, { sum: 5 })
  assert.ok(res.logs.some((l) => l.includes('adding')))
  assert.ok(res.activationId)
})

test('deploy with the documented {source:{inlineCode}} body then invoke runs the function', async () => {
  // fix-data-api-contract-mismatches (#601): the public deploy body nests the code under
  // `source.inlineCode`. Before the fix the source OBJECT was stored and invoke ran
  // `[object Object]` → error. It must unwrap to the code string.
  await exec.executeFunctions({
    identity: idA, workspaceId: WS_A, operation: 'deploy', name: 'sum_inline',
    payload: { source: { kind: 'nodejs', inlineCode: SUM, entryFile: 'index.js' } },
  })
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'invoke', name: 'sum_inline', payload: { a: 4, b: 5 } })
  assert.equal(res.status, 'success')
  assert.deepEqual(res.result, { sum: 9 })
})

test('list returns deployed functions without leaking source', async () => {
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'list' })
  assert.ok(res.items.some((f) => f.name === 'sum'))
  assert.ok(res.items.every((f) => !('source' in f)))
})

test('activations are recorded per function', async () => {
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'activations', name: 'sum' })
  assert.ok(res.items.length >= 1)
  assert.equal(res.items[0].success, true)
})

test('a function is not visible/invocable from another workspace', async () => {
  const list = await exec.executeFunctions({ identity: idB, workspaceId: WS_B, operation: 'list' })
  assert.equal(list.items.length, 0)
  await assert.rejects(
    () => exec.executeFunctions({ identity: idB, workspaceId: WS_B, operation: 'invoke', name: 'sum', payload: {} }),
    (e) => e.statusCode === 404
  )
})

test('a throwing function returns status error (not a 5xx)', async () => {
  await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'deploy', name: 'boom', payload: { source: BOOM } })
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'invoke', name: 'boom', payload: {} })
  assert.equal(res.status, 'error')
  assert.match(res.error, /kaboom/)
})

test('a runaway function is killed by the timeout', async () => {
  await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'deploy', name: 'loop', payload: { source: LOOP } })
  const res = await exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'invoke', name: 'loop', payload: {} })
  assert.equal(res.status, 'timeout')
})

test('invoking an unknown function → 404', async () => {
  await assert.rejects(
    () => exec.executeFunctions({ identity: idA, workspaceId: WS_A, operation: 'invoke', name: 'nope', payload: {} }),
    (e) => e.statusCode === 404
  )
})

test('missing tenant identity → 401', async () => {
  await assert.rejects(
    () => exec.executeFunctions({ workspaceId: WS_A, identity: {}, operation: 'list' }),
    (e) => e.statusCode === 401
  )
})
