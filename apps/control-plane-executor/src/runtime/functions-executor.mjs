// Functions executor (change: add-functions-execute).
//
// Like Kafka, Functions has no executable adapter plan and needs a runtime. This executor is
// backend-pluggable: it ships a LOCAL worker_threads backend (isolated thread, timeout-bounded,
// captured logs) for dev/test, and accepts any { invoke(source, params) } backend — the
// PRODUCTION backend is Knative (one pod per function), already built at
// apps/control-plane/function-executor.mjs. Functions + activations are tenant-scoped by
// workspace in the store (in-memory by default; a Postgres/registry-backed store can be injected).
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'

import { clientError } from './errors.mjs'

// Resolve the function's invocation input from the request body. The documented body is the
// `{ parameters: {...} }` envelope (OpenAPI FunctionInvocationWriteRequest); a bare top-level
// input map is also accepted so a body like {n:21} is honored, not silently dropped. Envelope-only
// fields are never passed to the function as input.
export function invocationInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  if (body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)) {
    return body.parameters
  }
  const { parameters, responseMode, triggerContext, idempotencyScope, versionId, execution, ...rest } = body
  return rest
}

// The worker receives a pre-wrapped factory body + params; it builds the function with only an
// injected console in scope and runs it. (Dev isolation: separate thread + hard timeout. NOT a
// security sandbox — production uses Knative pods.)
const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const logs = [];
const c = (...a) => logs.push(a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' '));
const sandboxConsole = { log: c, info: c, warn: c, error: c };
(async () => {
  try {
    const fn = new Function('console', workerData.wrapped)(sandboxConsole);
    if (typeof fn !== 'function') throw new Error('function source must define main(params)');
    const result = await fn(workerData.params || {});
    parentPort.postMessage({ ok: true, result: result === undefined ? null : result, logs });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e), logs });
  }
})();
`

export function localWorkerBackend({ timeoutMs = 5000 } = {}) {
  return {
    async invoke(source, params) {
      const wrapped = `${source}\nreturn (typeof main === 'function' ? main : (typeof handler === 'function' ? handler : null));`
      return new Promise((resolve) => {
        const worker = new Worker(WORKER_SCRIPT, { eval: true, workerData: { wrapped, params } })
        const timer = setTimeout(() => {
          worker.terminate()
          resolve({ ok: false, error: 'function execution timed out', logs: [], timedOut: true })
        }, timeoutMs)
        worker.once('message', (msg) => { clearTimeout(timer); worker.terminate(); resolve(msg) })
        worker.once('error', (err) => { clearTimeout(timer); worker.terminate(); resolve({ ok: false, error: err.message, logs: [] }) })
      })
    }
  }
}

export function inMemoryFunctionStore() {
  const fns = new Map() // ws\0name -> { name, runtime, source, workspaceId, createdAt }
  const acts = new Map() // ws\0name -> [activation]
  const key = (ws, name) => `${ws}${name}`
  return {
    async deploy(ws, fn) {
      const record = { ...fn, workspaceId: ws, createdAt: new Date().toISOString() }
      fns.set(key(ws, fn.name), record)
      return record
    },
    async get(ws, name) { return fns.get(key(ws, name)) ?? null },
    async list(ws) {
      return [...fns.values()].filter((f) => f.workspaceId === ws).map(({ source, ...meta }) => meta)
    },
    async recordActivation(ws, name, activation) {
      const k = key(ws, name)
      const arr = acts.get(k) ?? []
      arr.unshift(activation)
      acts.set(k, arr.slice(0, 50))
    },
    async listActivations(ws, name) { return acts.get(key(ws, name)) ?? [] }
  }
}

export function createFunctionsExecutor(options = {}) {
  const store = options.store ?? inMemoryFunctionStore()
  const backend = options.backend ?? localWorkerBackend({ timeoutMs: options.timeoutMs })

  // params: { operation, workspaceId, name, payload, identity:{tenantId,workspaceId} }
  async function executeFunctions(params) {
    const identity = params.identity ?? {}
    const workspaceId = params.workspaceId ?? identity.workspaceId
    if (!identity.tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING')
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING')
    const op = params.operation

    if (op === 'deploy') {
      const name = params.name ?? params.payload?.name
      // The public deploy body nests the code under `source.inlineCode` (or `source.code`); a
      // bare string source is also accepted. Resolve to the code STRING so the backend never
      // receives — and stringifies — the source object (which made invoke run `[object Object]`).
      const rawSource = params.payload?.source ?? params.source
      const source = typeof rawSource === 'string' ? rawSource : (rawSource?.inlineCode ?? rawSource?.code ?? rawSource?.sourceCode)
      if (!name || !source) throw clientError('deploy requires name + source', 400, 'INVALID_FUNCTION')
      const runtime = params.payload?.runtime ?? (rawSource && typeof rawSource === 'object' ? rawSource.kind : undefined) ?? 'nodejs'
      const fn = await store.deploy(workspaceId, { name, source, runtime })
      return { name: fn.name, runtime: fn.runtime, createdAt: fn.createdAt }
    }
    if (op === 'list') return { items: await store.list(workspaceId) }
    if (op === 'get') {
      const fn = await store.get(workspaceId, params.name)
      if (!fn) throw clientError('Function not found', 404, 'FUNCTION_NOT_FOUND')
      const { source, ...meta } = fn
      return { ...meta, hasSource: Boolean(source) }
    }
    if (op === 'activations') return { items: await store.listActivations(workspaceId, params.name) }
    if (op === 'invoke') {
      const fn = await store.get(workspaceId, params.name)
      if (!fn) throw clientError('Function not found', 404, 'FUNCTION_NOT_FOUND')
      const started = Date.now()
      const out = await backend.invoke(fn.source, invocationInput(params.payload))
      const activation = {
        activationId: randomUUID(),
        at: new Date().toISOString(),
        success: out.ok === true,
        durationMs: Date.now() - started
      }
      await store.recordActivation(workspaceId, params.name, activation)
      if (out.ok !== true) {
        return { activationId: activation.activationId, status: out.timedOut ? 'timeout' : 'error', error: out.error, logs: out.logs ?? [] }
      }
      return { activationId: activation.activationId, status: 'success', result: out.result, logs: out.logs ?? [], durationMs: activation.durationMs }
    }
    throw clientError(`Unsupported functions operation ${op}`, 400, 'UNSUPPORTED_OPERATION')
  }

  return { executeFunctions }
}
