// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { sessionCases } from './cases/session.mjs'
import * as session from '../src/session'
import { hintKey, loginSession, recordFetch, sessionKey, withSession } from './cases/support.mjs'

for (const [name, run] of sessionCases) it(name, run)

afterEach(() => {
  session.setConsoleSessionRetry401Invalidation(false)
  vi.restoreAllMocks()
})

it('invalidates an expired session when the retry is still unauthorized', () => withSession(async () => {
  session.setConsoleSessionRetry401Invalidation(true)
  session.persistConsoleShellSession(loginSession())
  let events = 0
  const unsubscribe = session.subscribeConsoleSessionInvalidated(() => { events++ })
  try {
    const requests = recordFetch(({ method }, index) => {
      if (method === 'POST') {
        expect(events).toBe(0)
        expect(session.readConsoleShellSession()?.sessionId).toBe('synthetic-session')
        return Response.json(loginSession())
      }
      return Response.json({ code: index === 1 ? 'FIRST_401' : 'RETRY_401' }, { status: 401 })
    })
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401, code: 'RETRY_401' })
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull()
    expect(JSON.parse(window.sessionStorage.getItem(hintKey)!)).toEqual({
      statusView: 'login', title: 'Tu sesión ha expirado', message: 'Vuelve a autenticarte para continuar en la consola.'
    })
    expect(events).toBe(1)
  } finally {
    unsubscribe()
  }
}))

it('leaves the session and hint unchanged without the opt-in', () => withSession(async () => {
  session.persistConsoleShellSession(loginSession())
  session.persistConsoleAuthStatusHint({ statusView: 'login', title: 'Existing hint', message: 'Keep this hint' })
  const before = window.sessionStorage.getItem(sessionKey)
  const hint = window.sessionStorage.getItem(hintKey)
  const invalidated = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(invalidated)
  try {
    recordFetch(({ method }) => method === 'POST'
      ? Response.json(loginSession())
      : Response.json({ code: 'RETRY_401' }, { status: 401 }))
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401, code: 'RETRY_401' })
    expect(window.sessionStorage.getItem(sessionKey)).toBe(before)
    expect(window.sessionStorage.getItem(hintKey)).toBe(hint)
    expect(invalidated).not.toHaveBeenCalled()
  } finally { unsubscribe() }
}))

it.each([
  { firstStatus: 403, retryStatus: 401 },
  { firstStatus: 500, retryStatus: 401 },
  { firstStatus: 401, retryStatus: 500 },
  { firstStatus: 401, retryStatus: 200 }
])('only invalidates a retry 401 ($firstStatus then $retryStatus)', ({ firstStatus, retryStatus }) => withSession(async () => {
  session.setConsoleSessionRetry401Invalidation(true)
  session.persistConsoleShellSession(loginSession())
  const invalidated = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(invalidated)
  try {
    const requests = recordFetch(({ method }, index) => method === 'POST'
      ? Response.json(loginSession())
      : Response.json({ ok: true }, { status: index === 1 ? firstStatus : retryStatus }))
    const request = session.requestConsoleSessionJson('/v1/tenants')
    if (firstStatus === 401 && retryStatus === 200) await expect(request).resolves.toEqual({ ok: true })
    else await expect(request).rejects.toMatchObject({ status: firstStatus === 401 ? retryStatus : firstStatus })
    expect(requests).toHaveLength(firstStatus === 401 ? 3 : 1)
    expect(session.readConsoleShellSession()?.sessionId).toBe('synthetic-session')
    expect(window.sessionStorage.getItem(hintKey)).toBeNull()
    expect(invalidated).not.toHaveBeenCalled()
  } finally { unsubscribe() }
}))

it('does not invalidate when authentication is absent before a request', () => withSession(async () => {
  session.setConsoleSessionRetry401Invalidation(true)
  const invalidated = vi.fn()
  const unsubscribe = session.subscribeConsoleSessionInvalidated(invalidated)
  try {
    const requests = recordFetch(() => { throw new Error('Must not fetch') })
    await expect(session.requestConsoleSessionJson('/v1/tenants')).rejects.toMatchObject({ status: 401 })
    expect(requests).toHaveLength(0)
    expect(window.sessionStorage.getItem(hintKey)).toBeNull()
    expect(invalidated).not.toHaveBeenCalled()
  } finally { unsubscribe() }
}))

it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('invalidates mutating %s requests after their retry 401', method => withSession(async () => {
  session.setConsoleSessionRetry401Invalidation(true)
  session.persistConsoleShellSession(loginSession())
  const requests = recordFetch(({ url }) => url.endsWith('/refresh')
    ? Response.json(loginSession())
    : Response.json({ code: 'RETRY_401' }, { status: 401 }))
  await expect(session.requestConsoleSessionJson('/v1/tenants', { method })).rejects.toMatchObject({ status: 401 })
  expect(requests.map(({ method }) => method)).toEqual([method, 'POST', method])
  expect(session.readConsoleShellSession()).toBeNull()
}))

it('invalidates concurrent retries once, preserves refresh counts and resets after a new session', () => withSession(async () => {
  const runBurst = async (enabled: boolean) => {
    session.setConsoleSessionRetry401Invalidation(enabled)
    session.persistConsoleShellSession(loginSession())
    const requests = recordFetch(({ method }) => method === 'POST'
      ? Response.json(loginSession())
      : Response.json({ code: 'RETRY_401' }, { status: 401 }))
    const results = await Promise.allSettled([
      session.requestConsoleSessionJson('/v1/tenants'),
      session.requestConsoleSessionJson('/v1/workspaces')
    ])
    expect(results).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ status: 401, code: 'RETRY_401' }) },
      { status: 'rejected', reason: expect.objectContaining({ status: 401, code: 'RETRY_401' }) }
    ])
    return requests.map(({ method }) => method)
  }
  const baseline = await runBurst(false)
  expect(baseline).toEqual(['GET', 'GET', 'POST', 'GET', 'GET'])
  const invalidated = vi.fn()
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  const unsubscribe = session.subscribeConsoleSessionInvalidated(invalidated)
  try {
    expect(await runBurst(true)).toEqual(baseline)
    expect(invalidated).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls.filter(([key]) => key === sessionKey)).toHaveLength(1)
    expect(session.readConsoleShellSession()).toBeNull()
    // A new persisted session permits the next burst to invalidate again.
    expect(await runBurst(true)).toEqual(baseline)
    expect(invalidated).toHaveBeenCalledTimes(2)
    expect(remove.mock.calls.filter(([key]) => key === sessionKey)).toHaveLength(2)
  } finally { unsubscribe() }
}))
