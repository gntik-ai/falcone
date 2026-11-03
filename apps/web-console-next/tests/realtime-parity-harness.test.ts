import { expect, test, vi } from 'vitest'

vi.mock('@playwright/test', () => ({
  expect,
  test: { extend: (fixtures: unknown) => fixtures },
}))
vi.mock('./csp/server.mjs', () => ({ startServer: vi.fn() }))
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { test as fixtures } from './parity/harness.mjs'
import { capabilitiesPath, realtimeEndpoints, realtimePath } from './parity/pages/console-realtime-page.manifest'

interface RequestRecord { method: string; path: string; body: unknown }
interface Parity {
  network: { requests: RequestRecord[]; capabilityRequests: RequestRecord[]; allRequests: RequestRecord[] }
}
const origin = 'http://synthetic.test'
async function withHarness(use: (parity: Parity, send: (method: string, path: string, body?: unknown) => Promise<ReturnType<typeof vi.fn>>) => Promise<void>) {
  let handle!: (route: unknown) => Promise<void>
  const page = {
    clock: { setFixedTime: vi.fn() }, exposeBinding: vi.fn(), on: vi.fn(), addInitScript: vi.fn(),
    route: vi.fn((pattern: string, callback: typeof handle) => { if (pattern === '**/v1/**') handle = callback }),
  }
  await fixtures.parity[0]({ page, server: { origin }, role: 'superadmin', locale: 'es', pageEndpoints: realtimeEndpoints }, async (parity: Parity) => {
    await use(parity, async (method, path, body) => {
      const fulfill = vi.fn()
      await handle({ request: () => ({ method: () => method, url: () => new URL(path, origin).href, postDataJSON: () => body }), fulfill })
      return fulfill
    })
  })
}

test('shell capabilities stay observable without changing existing page request contracts', async () => {
  await withHarness(async (parity, send) => {
    const workspace = '/v1/workspaces?page%5Bsize%5D=100&sort=displayName'
    await send('GET', workspace)
    await send('GET', capabilitiesPath)
    const before = parity.network.requests.length
    await send('GET', realtimePath)
    expect(parity.network.requests.slice(before)).toEqual([{ method: 'GET', path: realtimePath, body: undefined }])
    expect(parity.network.capabilityRequests).toEqual([{ method: 'GET', path: capabilitiesPath, body: undefined }])
    expect(parity.network.allRequests).toEqual([
      { method: 'GET', path: workspace, body: undefined },
      { method: 'GET', path: capabilitiesPath, body: undefined },
      { method: 'GET', path: realtimePath, body: undefined },
    ])
    // Another document or tenant bootstrap remains visible to dedicated assertions.
    await send('GET', capabilitiesPath)
    expect(parity.network.capabilityRequests).toHaveLength(2)
    expect(parity.network.allRequests).toHaveLength(4)
  })
})

test.each([
  ['POST', capabilitiesPath, undefined],
  ['GET', `${capabilitiesPath}?unexpected=true`, undefined],
  ['GET', capabilitiesPath, { unexpected: true }],
  ['GET', `https://external.invalid${capabilitiesPath}`, undefined],
  ['GET', '/v1/unregistered', undefined],
] as const)('the automatic unmatched gate still rejects %s %s with body %j', async (method, path, body) => {
  let observed!: { network: Parity['network']; fulfill: ReturnType<typeof vi.fn> }
  await expect(withHarness(async (parity, send) => {
    observed = { network: parity.network, fulfill: await send(method, path, body) }
  })).rejects.toThrow('Unmatched requests:')
  expect(observed.fulfill).toHaveBeenCalledWith({ status: 404, json: { error_msg: '404 Route Not Found' } })
  expect(observed.network.capabilityRequests).toEqual([])
  expect(observed.network.requests).toEqual(observed.network.allRequests)
  expect(observed.network.allRequests).toHaveLength(1)
})
