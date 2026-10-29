import { expect, test, vi } from 'vitest'
import { planEndpoints, planBody } from './parity/pages/consolePlanCreate.manifest'
import { catalogResponse } from './parity/pages/console-plan-catalog-page.manifest'

// Exercise the real route handler without launching a browser or binding a socket.
vi.mock('@playwright/test', async () => ({
  test: { extend: (fixtures: unknown) => fixtures },
  expect: (await import('vitest')).expect,
}))
vi.mock('./csp/server.mjs', () => ({ startServer: vi.fn() }))
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { test as fixtures } from './parity/harness.mjs'

type MockRoute = {
  request: () => { method: () => string; url: () => string; postDataJSON: () => unknown }
  fulfill: ReturnType<typeof vi.fn>
}

test('create journeys can return to the catalog while other requests remain unmatched', async () => {
  let handle!: (route: MockRoute) => Promise<void>
  const page = {
    clock: { setFixedTime: vi.fn() }, exposeBinding: vi.fn(), on: vi.fn(), addInitScript: vi.fn(),
    route: vi.fn((pattern, callback) => { if (pattern === '**/v1/**') handle = callback }),
  }
  const origin = 'http://localhost'
  const accepted = [
    ['GET', '/v1/plans?page=1&pageSize=20'],
    ['GET', '/v1/plans?status=active&page=1&pageSize=20'],
    ['GET', '/v1/plans?page=2&pageSize=20'],
    ['GET', '/v1/plans?page=1&pageSize=50'],
  ]
  const rejected = [
    ['GET', '/v1/plans?page=1&pageSize=20&foo=1'],
    ['GET', '/v1/platform/runtime/knative?page=1'],
    ['GET', '/v1/plans'], ['GET', '/v1/plans?page=1'], ['GET', '/v1/plans?pageSize=20'],
    ['GET', '/v1/plans/?page=1&pageSize=20'], ['DELETE', '/v1/plans?page=1&pageSize=20'],
    ['GET', 'https://external.example.test/v1/plans?page=1&pageSize=20'],
  ]
  await fixtures.parity[0]({ page, server: { origin }, role: 'superadmin', locale: 'es', pageEndpoints: planEndpoints }, async (parity: { network: { requests: unknown[] } }) => {
    // Preserve the create endpoint and then follow its Discard destination.
    const create = { request: () => ({ method: () => 'POST', url: () => `${origin}/v1/plans`, postDataJSON: () => planBody }), fulfill: vi.fn() }
    await handle(create)
    expect(create.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 200, json: { id: 'p1' } })
    for (const [method, path] of [...accepted, ...rejected]) {
      const url = new URL(path, origin)
      const route = { request: () => ({ method: () => method, url: () => url.href, postDataJSON: () => undefined }), fulfill: vi.fn() }
      await handle(route)
      if (accepted.some(([allowedMethod, allowedPath]) => allowedMethod === method && allowedPath === path)) {
        const response = catalogResponse('45-mixed', url)
        expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: response.status, json: response.body })
      } else expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 404, json: { error_msg: '404 Route Not Found' } })
    }
    expect(parity.network.requests).toHaveLength(1 + accepted.length + rejected.length)
  }).then(() => { throw new Error('Invalid requests must fail fixture teardown') }, (error: Error) => {
    // The shared teardown must still list each invalid request, rather than hiding it.
    expect(error.message).toContain('Unmatched requests:')
    for (const [method, path] of rejected) {
      const url = new URL(path, origin)
      expect(error.message).toContain(`${method} ${url.pathname}${url.search}`)
    }
  })
})
