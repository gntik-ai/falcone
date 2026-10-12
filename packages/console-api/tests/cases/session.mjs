import assert from 'node:assert/strict'
import { hintKey, invalidatedEvent, loginSession, now, recordFetch, routeKey, sessionKey, snapshot, withSession } from './support.mjs'

export const sessionCases = [
  ['reads the exact snapshot persisted by base 7acbac0', () => withSession(async () => {
    const { readConsoleShellSession } = await import('@in-falcone/console-api/session')
    window.sessionStorage.setItem(sessionKey, JSON.stringify(snapshot))
    assert.deepEqual(readConsoleShellSession(), snapshot)
  })],
  ['preserves all three storage keys and their value formats', () => withSession(async () => {
    const session = await import('@in-falcone/console-api/session')
    session.persistConsoleShellSession(loginSession(), 'synthetic-tenant')
    assert.deepEqual(JSON.parse(window.sessionStorage.getItem(sessionKey)), snapshot)
    session.storeProtectedRouteIntent('/console/tenants')
    assert.equal(window.sessionStorage.getItem(routeKey), '"/console/tenants"')
    assert.equal(session.consumeProtectedRouteIntent(), '/console/tenants')
    assert.equal(window.sessionStorage.getItem(routeKey), null)
    const hint = { statusView: 'login', title: 'Synthetic title', message: 'Synthetic message' }
    session.persistConsoleAuthStatusHint(hint)
    assert.deepEqual(JSON.parse(window.sessionStorage.getItem(hintKey)), hint)
    assert.deepEqual(session.consumeConsoleAuthStatusHint(), hint)
    assert.equal(window.sessionStorage.getItem(hintKey), null)
  })],
  ...[200, 401].map(retryStatus => [
    `a first 401 refreshes once and retries once, even when the retry returns ${retryStatus}`,
    () => withSession(async () => {
      const session = await import('@in-falcone/console-api/session')
      session.persistConsoleShellSession(loginSession(), 'synthetic-tenant')
      const requests = recordFetch((_request, index) => {
        if (index === 1) return Response.json({ code: 'FIRST_401' }, { status: 401 })
        if (index === 2) return Response.json(loginSession({ tokenSet: { ...snapshot.tokenSet, accessToken: 'synthetic-new-access' } }))
        return Response.json({ code: 'RETRY_401', ok: true }, { status: retryStatus })
      })
      const request = session.requestConsoleSessionJson('/v1/tenants')
      if (retryStatus === 401) await assert.rejects(request, error => error.status === 401 && error.code === 'RETRY_401')
      else assert.equal((await request).ok, true)
      assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), [
        'GET /v1/tenants', 'POST /v1/auth/login-sessions/synthetic-session/refresh', 'GET /v1/tenants'
      ])
      assert.equal(requests[0].headers.get('Authorization'), 'Bearer synthetic-access')
      assert.equal(requests[2].headers.get('Authorization'), 'Bearer synthetic-new-access')
      assert.deepEqual(JSON.parse(requests[1].body), { refreshToken: 'synthetic-refresh', tenantId: 'synthetic-tenant' })
    })
  ]),
  ...[
    { status: 429, count: 2 }, { status: 504, count: 2 },
    { status: 503, retryable: true, count: 2 }, { status: 400, count: 1 }
  ].map(({ status, retryable, count }) => [
    `refresh failure ${status}${retryable ? ' retryable' : ''} makes ${count} POSTs and invalidates the session`,
    () => withSession(async () => {
      const session = await import('@in-falcone/console-api/session')
      session.persistConsoleShellSession(loginSession())
      let events = 0
      const listener = () => { events++ }
      window.addEventListener(invalidatedEvent, listener)
      try {
        const requests = recordFetch((_request, index) => index === 1
          ? Response.json({ code: 'ORIGINAL_401' }, { status: 401 })
          : Response.json({ code: 'REFRESH_FAILED', retryable }, { status }))
        await assert.rejects(session.requestConsoleSessionJson('/v1/tenants'), error => error.status === 401 && error.code === 'ORIGINAL_401')
        assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), [
          'GET /v1/tenants', ...Array(count).fill('POST /v1/auth/login-sessions/synthetic-session/refresh')
        ])
        assert.equal(window.sessionStorage.getItem(sessionKey), null)
        assert.deepEqual(JSON.parse(window.sessionStorage.getItem(hintKey)), {
          statusView: 'login', title: 'Tu sesión ha expirado', message: 'Vuelve a autenticarte para continuar en la consola.'
        })
        assert.equal(events, 1)
      } finally {
        window.removeEventListener(invalidatedEvent, listener)
      }
    })
  ]),
  ...['missing', 'expired'].map(refreshState => [
    `near-expiry access and ${refreshState} refresh token reject without fetching`,
    () => withSession(async () => {
      const session = await import('@in-falcone/console-api/session')
      const tokenSet = {
        ...snapshot.tokenSet, expiresAt: new Date(now + 30_000).toISOString(),
        ...(refreshState === 'missing' ? { refreshToken: '' } : { refreshExpiresAt: new Date(now - 1).toISOString() })
      }
      session.persistConsoleShellSession(loginSession({ tokenSet }))
      const requests = recordFetch(() => { throw new Error('Must not fetch') })
      await assert.rejects(session.requestConsoleSessionJson('/v1/tenants'), error => error.status === 401 && error.code === 'HTTP_401')
      assert.equal(requests.length, 0)
      assert.equal(window.sessionStorage.getItem(sessionKey), null)
    })
  ])
]
