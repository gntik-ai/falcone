import { expect, test } from 'vitest'
import { createEndpointRegistry } from './endpoint-registry'
import { operationEndpoints, operation, bodyFor, entries } from './pages/operationDetail.manifest'
// @ts-expect-error Read-only harness helper is JavaScript without declarations.
import { consumeResourceDiagnostic } from './resource-diagnostics.mjs'

test('body discriminators select detail/logs/result and unknown bodies fail closed', () => {
  const registry = createEndpointRegistry({}, () => ({}), operationEndpoints)
  for (const type of ['detail', 'logs', 'result']) expect(registry.find('POST', '/v1/async-operation-query', bodyFor(type))).toBe(`ops.${type}`)
  expect(registry.find('POST', '/v1/async-operation-query')).toBeUndefined()
  expect(registry.find('POST', '/v1/async-operation-query', bodyFor('list'))).toBeUndefined()
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
