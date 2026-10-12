import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { importDocuments } from './mongoApi'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
  persistConsoleShellSession({
    sessionId: 'ses_import_test',
    authenticationState: 'active',
    statusView: 'active',
    issuedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt,
    idleExpiresAt: expiresAt,
    refreshExpiresAt: expiresAt,
    sessionPolicy: {},
    tokenSet: {
      accessToken: 'test-only-access-token',
      refreshToken: 'test-only-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 3600,
      scope: 'openid',
      expiresAt,
      refreshExpiresAt: expiresAt
    }
  })
  fetchMock.mockResolvedValue(new Response('{"importedCount":1}', { headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

it('console import sends required JSON format and defaults to insert at the HTTP boundary', async () => {
  await importDocuments('ws1', 'appdb', 'notes', [{ _id: 'u1', name: 'alpha' }])
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe('/v1/mongo/workspaces/ws1/data/appdb/collections/notes/imports')
  expect(options?.method).toBe('POST')
  expect(JSON.parse(options?.body as string)).toEqual({
    format: 'json', mode: 'insert', documents: [{ _id: 'u1', name: 'alpha' }]
  })
})

it('console import forwards the caller-selected upsert mode at the HTTP boundary', async () => {
  await importDocuments('ws1', 'appdb', 'notes', [{ _id: 'u1', name: 'beta' }], 'upsert')
  const [, options] = fetchMock.mock.calls[0]
  expect(JSON.parse(options?.body as string)).toEqual({
    format: 'json', mode: 'upsert', documents: [{ _id: 'u1', name: 'beta' }]
  })
})
