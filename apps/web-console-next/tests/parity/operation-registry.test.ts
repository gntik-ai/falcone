import { expect, test, vi } from 'vitest'
import { createEndpointRegistry } from './endpoint-registry'
import { operationEndpoints, operation, bodyFor, entries } from './pages/operationDetail.manifest'
// @ts-expect-error Read-only harness helper is JavaScript without declarations.
import { consumeResourceDiagnostic } from './resource-diagnostics.mjs'

test('body discriminators select list/detail/logs/result and unknown bodies fail closed', () => {
  const registry = createEndpointRegistry({}, () => ({}), operationEndpoints)
  for (const type of ['list', 'detail', 'logs', 'result']) expect(registry.find('POST', '/v1/async-operation-query', bodyFor(type))).toBe(`ops.${type}`)
  expect(registry.find('POST', '/v1/async-operation-query')).toBeUndefined()
  expect(registry.find('POST', '/v1/async-operation-query', bodyFor('unknown'))).toBeUndefined()
  expect(registry.responseFor('ops.detail', 'tenant_owner').body).toEqual(operation)
  expect(registry.responseFor('ops.logs', 'tenant_owner', bodyFor('logs', 20)).body).toMatchObject({ entries: entries.slice(20, 40) })
})

test('overlapping body discriminators and path-only aliases still collide', () => {
  const endpoint = operationEndpoints['ops.detail']
  for (const requestBody of [undefined, {}, { queryType: 'detail' }, { other: 'value' }] as (Record<string, string> | undefined)[]) {
    expect(() => createEndpointRegistry({}, () => ({}), { detail: endpoint, alias: { ...endpoint, requestBody } })).toThrow(/collision/)
  }
  expect(() => createEndpointRegistry({ shell: endpoint }, () => ({}), { detail: endpoint })).toThrow(/collision/)
})

test('named fixture sequences exhaust retries and then recover independently', () => {
  const registry = createEndpointRegistry({}, () => ({}), operationEndpoints)
  registry.setVariants({ 'ops.detail': '500-then-success' })
  for (let i = 0; i < 3; i++) expect(registry.responseFor('ops.detail', 'tenant_owner').status).toBe(500)
  expect(registry.responseFor('ops.result', 'tenant_owner').status).toBe(200)
  expect(registry.responseFor('ops.detail', 'tenant_owner').body).toEqual(operation)
  registry.setVariants({ 'ops.detail': '500-then-success' })
  expect(registry.responseFor('ops.detail', 'tenant_owner').status).toBe(500)
})

test('recovered logs keep honoring pagination after automatic and manual retries', () => {
  const registry = createEndpointRegistry({}, () => ({}), operationEndpoints)
  registry.setVariants({ 'ops.logs': '500-then-success' })
  for (let i = 0; i < 3; i++) expect(registry.responseFor('ops.logs', 'tenant_owner', bodyFor('logs', 20)).status).toBe(500)
  for (const offset of [20, 40, 0]) {
    expect(registry.responseFor('ops.logs', 'tenant_owner', bodyFor('logs', offset))).toEqual({
      status: 200, body: { queryType: 'logs', operationId: 'op_1', entries: entries.slice(offset, offset + 20), total: 45, pagination: { limit: 20, offset } },
    })
  }
})

test('CSP session fixtures handle all operation queries and keep unrelated requests unmatched', async () => {
  // @ts-expect-error Existing browser helper is JavaScript without declarations.
  const { installSession } = await import('../browser-session.mjs')
  const page = { addInitScript: vi.fn(), route: vi.fn() }
  const unmatched = await installSession(page)
  const handler = page.route.mock.calls[0][1]
  async function send(method: string, path: string, body?: unknown, invalidJson = false) {
    const route = {
      request: () => ({ method: () => method, url: () => `http://localhost${path}`, postDataJSON: () => { if (invalidJson) throw new SyntaxError('invalid JSON'); return body } }),
      fulfill: vi.fn(), abort: vi.fn(),
    }
    await handler(route)
    return route
  }
  const tenants = await send('GET', '/v1/tenants?page%5Bsize%5D=100&sort=displayName')
  expect(tenants.fulfill).toHaveBeenCalledWith({ json: { items: [], page: { after: null } } })
  for (const queryType of ['detail', 'logs', 'result']) {
    const route = await send('POST', '/v1/async-operation-query', bodyFor(queryType))
    expect(route.fulfill).toHaveBeenCalledWith({ status: 200, json: expect.objectContaining({ queryType, operationId: 'op_1' }) })
    expect(route.abort).not.toHaveBeenCalled()
  }
  const list = await send('POST', '/v1/async-operation-query', { queryType: 'list', filters: {}, pagination: { limit: 20, offset: 0 } })
  expect(list.fulfill).toHaveBeenCalledWith({ status: 200, json: { queryType: 'list', items: [], total: 0, pagination: { limit: 20, offset: 0 } } })
  expect(unmatched).toEqual([])
  for (const [method, path, body, invalidJson] of [
    ['GET', '/v1/async-operation-query', bodyFor('detail'), false],
    ['POST', '/v1/async-operation-query', bodyFor('unknown'), false],
    ['POST', '/v1/async-operation-query?unexpected=true', bodyFor('detail'), false],
    ['POST', '/v1/unknown', {}, false],
    ['POST', '/v1/async-operation-query', undefined, true],
  ] as const) {
    const route = await send(method, path, body, invalidJson)
    expect(route.abort).toHaveBeenCalledOnce()
    expect(route.fulfill).not.toHaveBeenCalled()
  }
  expect(unmatched).toHaveLength(5)
})

test('only exact injected resource diagnostics are tolerated once; console errors remain faults', () => {
  const url = 'http://localhost/v1/async-operation-query'
  const injected = [{ url, kind: '500' }, { url, kind: 'network' }]
  const http = 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
  expect(consumeResourceDiagnostic(http, 'http://localhost/app.js', injected)).toBe(false)
  expect(consumeResourceDiagnostic('synthetic-console-error', url, injected)).toBe(false)
  expect(consumeResourceDiagnostic('Failed to load resource: net::ERR_CONNECTION_REFUSED', url, injected)).toBe(false)
  expect(consumeResourceDiagnostic(http, url, injected)).toBe(true)
  expect(consumeResourceDiagnostic(http, url, injected)).toBe(false)
  expect(consumeResourceDiagnostic('Failed to load resource: net::ERR_FAILED', url, injected)).toBe(true)
  expect(injected).toEqual([])
})

test('viewport reports certify each complete matrix cell without changing path-only report shapes', async () => {
  // @ts-expect-error Existing reporter helper is JavaScript without declarations.
  const { buildReports } = await import('./report.mjs')
  const checks = ['data', 'action', 'error-empty', 'accessibility', 'runtime-health', 'responsive', 'visual-review', 'kit-conformance']
  const original = checks.map((check) => ({ page: 'overview', role: 'tenant_owner', locale: 'es', check, status: 'passed', errors: [] }))
  const legacy = buildReports(original)
  expect(legacy).toHaveLength(1)
  expect(legacy[0]).toMatchObject({ page: 'overview', result: 'PARITY_PASS' })
  expect(legacy[0]).not.toHaveProperty('viewport')
  const rows = [375, 768, 1280].flatMap((viewport) => original.map((row) => ({ ...row, page: 'operationDetail', viewport })))
  const reports = buildReports(rows)
  expect(reports.map((report: { viewport: number }) => report.viewport)).toEqual([375, 768, 1280])
  for (const report of reports) expect(report.result).toBe('PARITY_PASS')
  rows[0].status = 'failed'
  expect(buildReports(rows)[0]).not.toHaveProperty('result')
})
