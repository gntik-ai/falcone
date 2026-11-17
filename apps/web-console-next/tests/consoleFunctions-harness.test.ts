import { expect, test, vi } from 'vitest'
import { activationPath, actionPath, functionsEndpoints, inventoryPath, sectionFailureEndpoints } from './parity/pages/console-functions-page.manifest'

// Exercise the real route and console handlers without launching a browser or binding a socket.
vi.mock('@playwright/test', async () => ({
  test: { extend: (fixtures: unknown) => fixtures },
  expect: (await import('vitest')).expect,
}))
vi.mock('./csp/server.mjs', () => ({ startServer: vi.fn() }))
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { test as fixtures } from './parity/harness.mjs'

type Handler = (...args: unknown[]) => unknown
const origin = 'http://localhost'
const mockRoute = (method: string, path: string) => ({ request: () => ({ method: () => method, url: () => `${origin}${path}`, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() })
const diagnostic = (status: number, url: string) => ({ type: () => 'error', text: () => `Failed to load resource: the server responded with a status of ${status} (Synthetic)`, location: () => ({ url }) })
const sectionPaths = { 'functions-detail': actionPath(1), 'functions-versions': `${actionPath(1)}/versions`, 'functions-activations': `${actionPath(1)}/activations`, 'functions-activation': activationPath(), 'functions-logs': `${activationPath()}/logs`, 'functions-result': `${activationPath()}/result` }

// Runs one journey through the fixture teardown and returns the recorded faults.
async function journey(variants: Record<string, string | string[]>, steps: (helpers: { fetch: (method: string, path: string) => Promise<void>; console: (message: unknown) => void }) => Promise<void>) {
  const handlers: Record<string, Handler> = {}
  let handle!: (route: ReturnType<typeof mockRoute>) => Promise<void>
  const page = {
    clock: { setFixedTime: vi.fn() }, exposeBinding: vi.fn(), addInitScript: vi.fn(), on: vi.fn((event: string, callback: Handler) => { handlers[event] = callback }),
    route: vi.fn((pattern: string, callback: typeof handle) => { if (pattern === '**/v1/**') handle = callback }),
  }
  let faults: string[] = []
  await fixtures.parity[0]({ page, server: { origin }, role: 'superadmin', locale: 'es', pageEndpoints: functionsEndpoints, preserveLocale: false }, async (parity: { faults: string[]; network: { setVariants: (value: Record<string, string | string[]>) => void } }) => {
    parity.network.setVariants(variants)
    await steps({ fetch: async (method, path) => { await handle(mockRoute(method, path)) }, console: (message) => handlers.console(message) })
    faults = parity.faults
  })
  return faults
}

test('the six functions section GETs are the only exempt endpoints', () => {
  expect(sectionFailureEndpoints).toEqual(Object.keys(sectionPaths))
})

test.each(Object.entries(sectionPaths))('the injected 500 diagnostic of %s yields no fault in functions:section-500', async (name, path) => {
  const faults = await journey({ [name]: '500' }, async ({ fetch, console }) => { await fetch('GET', path); console(diagnostic(500, `${origin}${path}`)) })
  expect(faults).toEqual([])
})

test('a 500 followed by a success is consumed once and the later success needs no diagnostic', async () => {
  const faults = await journey({ 'functions-versions': ['500', 'success'] }, async ({ fetch, console }) => { await fetch('GET', sectionPaths['functions-versions']); console(diagnostic(500, `${origin}${sectionPaths['functions-versions']}`)); await fetch('GET', sectionPaths['functions-versions']) })
  expect(faults).toEqual([])
})

test('an application console.error still fails the journey', async () => {
  const path = sectionPaths['functions-detail']
  const faults = await journey({ 'functions-detail': '500' }, async ({ fetch, console }) => { await fetch('GET', path); console({ type: () => 'error', text: () => 'synthetic application error', location: () => ({ url: `${origin}${path}` }) }) })
  expect(faults).toEqual(['console.error: synthetic application error'])
})

test.each([
  ['another URL', 500, `${actionPath(1)}/versions`],
  ['another status', 503, actionPath(1)],
  ['a 404 status', 404, actionPath(1)],
])('a diagnostic with %s still fails the journey', async (_name, status, url) => {
  const path = sectionPaths['functions-detail']
  const faults = await journey({ 'functions-detail': '500' }, async ({ fetch, console }) => { await fetch('GET', path); console(diagnostic(status, `${origin}${url}`)) })
  expect(faults).toHaveLength(1)
  expect(faults[0]).toContain('Failed to load resource')
})

test('a 500 outside functions:section-500 is not exempt', async () => {
  // The inventory, the invoke POST and a section GET whose variant is not 500 keep failing the journey.
  for (const [name, method, path, variant] of [['functions-inventory', 'GET', inventoryPath, '500'], ['functions-invoke', 'POST', `${actionPath(1)}/invocations`, '500'], ['functions-detail', 'GET', actionPath(1), '500-then-ok']] as const) {
    const faults = await journey({ [name]: variant }, async ({ fetch, console }) => { await fetch(method, path); console(diagnostic(500, `${origin}${path}`)) })
    expect(faults, name).toHaveLength(1)
  }
})
