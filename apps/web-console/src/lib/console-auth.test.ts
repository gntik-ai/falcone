import { afterEach, describe, expect, it, vi } from 'vitest'

import { refreshConsoleLoginSession, terminateConsoleLoginSession } from './console-auth'

// Regression for #667: console logout must carry the session's refresh token in
// the DELETE body so the control plane can revoke it at Keycloak and end the SSO
// session. Previously the request sent only the Bearer access token and logout was
// a no-op (the refresh token kept minting access tokens).

const fetchMock = vi.fn<typeof fetch>()

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('terminateConsoleLoginSession', () => {
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('sends the refresh token in the DELETE body and the Bearer header (#667)', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, { sessionId: 'ses_abc', status: 'accepted', acceptedAt: '2026-06-21T00:00:00.000Z' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await terminateConsoleLoginSession('ses_abc', 'access-token-placeholder', 'refresh-token-placeholder')

    expect(result).toEqual({ sessionId: 'ses_abc', status: 'accepted', acceptedAt: '2026-06-21T00:00:00.000Z' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/v1/auth/login-sessions/ses_abc')
    expect(requestInit?.method).toBe('DELETE')

    // The refresh token MUST be serialized into the request body.
    expect(requestInit?.body).toBe(JSON.stringify({ refreshToken: 'refresh-token-placeholder' }))

    // The Bearer header MUST still be present.
    const headers = new Headers(requestInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token-placeholder')
  })

  it('url-encodes the sessionId in the path', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, { sessionId: 'ses a/b', status: 'accepted', acceptedAt: '2026-06-21T00:00:00.000Z' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await terminateConsoleLoginSession('ses a/b', 'access-token-placeholder', 'refresh-token-placeholder')

    const [url] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/v1/auth/login-sessions/${encodeURIComponent('ses a/b')}`)
  })

  it('sends tenantId for tenant logout while preserving the platform body', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, { sessionId: 'ses_abc', status: 'accepted' }))
    vi.stubGlobal('fetch', fetchMock)
    await terminateConsoleLoginSession('ses_abc', 'example-access', 'example-refresh', 'ten_acme')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      refreshToken: 'example-refresh', tenantId: 'ten_acme'
    }))
  })
})

describe('refreshConsoleLoginSession', () => {
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('sends tenantId with the refresh token', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await refreshConsoleLoginSession('ses_abc', 'example-refresh', 'ten_acme')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      refreshToken: 'example-refresh', tenantId: 'ten_acme'
    }))
  })
})
