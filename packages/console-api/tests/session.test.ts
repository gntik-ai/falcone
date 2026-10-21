// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { sessionCases } from './cases/session.mjs'
import * as session from '../src/session'
import { loginSession, recordFetch, sessionKey, snapshot, withSession } from './cases/support.mjs'

for (const [name, run] of sessionCases) it(name, run)

it('opt-in retry 401 clears the session, stores the expired hint and rethrows without extra requests', () => withSession(async () => {
  session.persistConsoleShellSession(loginSession())
  const events = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(events)
  session.setConsoleSessionRetryUnauthorizedHandler(session.invalidateConsoleShellSession)
  try {
    const requests = recordFetch((_request, index) => index === 2
      ? Response.json(loginSession({ tokenSet: { ...snapshot.tokenSet, accessToken: 'synthetic-new-access' } }))
      : Response.json({ code: 'DENIED' }, { status: 401 }))
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401, code: 'DENIED' })
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /v1/tenants', 'POST /v1/auth/login-sessions/synthetic-session/refresh', 'GET /v1/tenants',
    ])
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull()
    expect(session.readConsoleAuthStatusHint()).toEqual({
      statusView: 'login', title: 'Tu sesión ha expirado', message: 'Vuelve a autenticarte para continuar en la consola.',
    })
    expect(events).toHaveBeenCalledTimes(1)
  } finally {
    session.setConsoleSessionRetryUnauthorizedHandler(null)
    unsubscribe()
  }
}))

it('without opt-in retry 401 keeps the refreshed session and emits no event, with the same refresh count', () => withSession(async () => {
  const events = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(events)
  const logs: string[][] = []
  try {
    for (const handler of [null, session.invalidateConsoleShellSession]) {
      session.setConsoleSessionRetryUnauthorizedHandler(handler)
      session.persistConsoleShellSession(loginSession())
      const requests = recordFetch((_request, index) => index === 2
        ? Response.json(loginSession({ tokenSet: { ...snapshot.tokenSet, accessToken: 'synthetic-new-access' } }))
        : Response.json({ code: 'RETRY_401' }, { status: 401 }))
      await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401, code: 'RETRY_401' })
      logs.push(requests.map(({ method, url }) => `${method} ${url}`))
      if (!handler) {
        expect(session.readConsoleShellSession()?.tokenSet?.accessToken).toBe('synthetic-new-access')
        expect(session.readConsoleAuthStatusHint()).toBeNull()
        expect(events).not.toHaveBeenCalled()
      }
    }
    expect(logs[1]).toEqual(logs[0])
    expect(logs[0].filter((request) => request.startsWith('POST '))).toHaveLength(1)
  } finally {
    session.setConsoleSessionRetryUnauthorizedHandler(null)
    unsubscribe()
  }
}))

it('two concurrent retry 401s invalidate and clear only once', () => withSession(async () => {
  session.persistConsoleShellSession(loginSession())
  const events = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(events)
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  session.setConsoleSessionRetryUnauthorizedHandler(session.invalidateConsoleShellSession)
  let release!: () => void
  const bothRetries = new Promise<void>((resolve) => { release = resolve })
  let retries = 0
  try {
    const requests = recordFetch(async ({ method, headers }) => {
      if (method === 'POST') return Response.json(loginSession({ tokenSet: { ...snapshot.tokenSet, accessToken: 'synthetic-new-access' } }))
      if (headers.get('Authorization') === 'Bearer synthetic-new-access') {
        if (++retries === 2) release()
        await bothRetries
      }
      return Response.json({ code: 'DENIED' }, { status: 401 })
    })
    const results = await Promise.allSettled([
      session.requestConsoleSessionJson('/v1/tenants'), session.requestConsoleSessionJson('/v1/workspaces'),
    ])
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 401 }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 401 }) }),
    ])
    expect(requests.filter(({ method }) => method === 'GET')).toHaveLength(4)
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1)
    expect(events).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls.filter(([key]) => key === sessionKey)).toHaveLength(1)
    expect(session.readConsoleShellSession()).toBeNull()
  } finally {
    remove.mockRestore()
    session.setConsoleSessionRetryUnauthorizedHandler(null)
    unsubscribe()
  }
}))

it.each([403, 500, 'network'])('retry %s does not invoke the opt-in handler', (retryStatus) => withSession(async () => {
  session.persistConsoleShellSession(loginSession())
  const handler = vi.fn(session.invalidateConsoleShellSession)
  session.setConsoleSessionRetryUnauthorizedHandler(handler)
  try {
    const requests = recordFetch((_request, index) => {
      if (index === 1) return Response.json({}, { status: 401 })
      if (index === 2) return Response.json(loginSession())
      if (retryStatus === 'network') throw new TypeError('Synthetic network failure')
      return Response.json({}, { status: retryStatus })
    })
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject(
      retryStatus === 'network' ? { message: 'Synthetic network failure' } : { status: retryStatus },
    )
    expect(handler).not.toHaveBeenCalled()
    expect(session.readConsoleShellSession()).not.toBeNull()
    expect(requests).toHaveLength(3)
  } finally { session.setConsoleSessionRetryUnauthorizedHandler(null) }
}))

it('no-access-token 401 does not invoke the opt-in handler or fetch', () => withSession(async () => {
  const handler = vi.fn(session.invalidateConsoleShellSession)
  session.setConsoleSessionRetryUnauthorizedHandler(handler)
  try {
    const requests = recordFetch(() => { throw new Error('Must not fetch') })
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401, code: 'HTTP_401' })
    expect(handler).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  } finally { session.setConsoleSessionRetryUnauthorizedHandler(null) }
}))
