import { expect, test, vi } from 'vitest'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'
import { ready, runtimePath } from './parity/pages/consoleRuntime.manifest'

type MockRoute = {
  request: () => { url: () => string; method: () => string; postDataJSON: () => undefined }
  fulfill: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
}

test('CSP session serves the runtime fixture and rejects unexpected methods, paths and queries', async () => {
  let handle!: (route: MockRoute) => Promise<void>
  const page = {
    addInitScript: vi.fn(),
    route: vi.fn((_pattern: string, callback: typeof handle) => { handle = callback }),
  }
  const unmatched = await installSession(page)
  for (const [method, path] of [
    ['GET', runtimePath],
    ['POST', runtimePath],
    ['GET', `${runtimePath}/unexpected`],
    ['GET', `${runtimePath}?unexpected=true`],
  ]) {
    const route = {
      request: () => ({ url: () => `http://localhost${path}`, method: () => method, postDataJSON: () => undefined }),
      fulfill: vi.fn(), abort: vi.fn(),
    }
    await handle(route)
    if (method === 'GET' && path === runtimePath) {
      expect(route.fulfill).toHaveBeenCalledExactlyOnceWith({ status: 200, json: ready })
      expect(route.abort).not.toHaveBeenCalled()
      expect(unmatched).toEqual([])
    } else {
      expect(route.fulfill).not.toHaveBeenCalled()
      expect(route.abort).toHaveBeenCalledExactlyOnceWith()
    }
  }
  expect(unmatched).toEqual([
    `POST ${runtimePath}`,
    `GET ${runtimePath}/unexpected`,
    `GET ${runtimePath}?unexpected=true`,
  ])
})
