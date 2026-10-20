import { expect, test } from 'vitest'
import { createParityNetwork } from './parity/network'

test.each(['workspace_admin', 'workspace_viewer'] as const)('page endpoints coexist with shell fixtures for %s and unknown routes remain unmatched', async (role) => {
  const network = createParityNetwork(role)
  network.registerEndpoints({ page: { method: 'GET', path: '/v1/synthetic-page', fixtures: { success: { title: 'Synthetic page' } } } })
  expect(await network.respond('GET', '/v1/synthetic-page')).toEqual({ status: 200, body: { title: 'Synthetic page' } })
  expect(await network.respond('POST', '/v1/auth/login-sessions/synthetic-session/refresh')).toMatchObject({ status: 200, body: { principal: { platformRoles: [role] } } })
  expect(await network.respond('GET', '/v1/unregistered')).toBeNull()
  expect(await network.respond('POST', '/v1/synthetic-page')).toBeNull()
  expect(() => network.registerEndpoints({ page: { method: 'GET', path: '/v1/other', fixtures: { success: {} } } })).toThrow(/Duplicate/)
  expect(() => network.registerEndpoints({ other: { method: 'GET', path: '/v1/tenants', fixtures: { success: {} } } })).toThrow(/Duplicate/)
})

test('endpoint scenarios delay each response, fail then succeed, and reset for a fresh navigation', async () => {
  const { vi } = await import('vitest')
  vi.useFakeTimers()
  try {
    const network = createParityNetwork('workspace_admin')
    network.registerEndpoints({ page: { method: 'GET', path: '/v1/synthetic-page', fixtures: { success: { title: 'Ready' }, empty: { items: [] } } } })
    network.setVariants({ page: { delayMs: 500, sequence: ['500', 'success'] } })
    let settled = false
    const first = network.respond('GET', '/v1/synthetic-page').then((value) => { settled = true; return value })
    await vi.advanceTimersByTimeAsync(499)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toMatchObject({ status: 500 })
    const retry = network.respond('GET', '/v1/synthetic-page')
    await vi.advanceTimersByTimeAsync(500)
    expect(await retry).toEqual({ status: 200, body: { title: 'Ready' } })
    const again = network.respond('GET', '/v1/synthetic-page')
    await vi.advanceTimersByTimeAsync(500)
    expect(await again).toEqual({ status: 200, body: { title: 'Ready' } })
    network.setVariants({ page: { sequence: ['403', 'empty'] }, tenants: { delayMs: 100, variant: '403' } })
    expect(await network.respond('GET', '/v1/synthetic-page')).toMatchObject({ status: 403 })
    expect(await network.respond('GET', '/v1/synthetic-page')).toEqual({ status: 200, body: { items: [] } })
    const shell = network.respond('GET', '/v1/tenants')
    await vi.advanceTimersByTimeAsync(100)
    expect(await shell).toMatchObject({ status: 403 })
    network.setVariants({ page: 'network' })
    expect(await network.respond('GET', '/v1/synthetic-page')).toEqual({ network: true })
  } finally { vi.useRealTimers() }
})
