import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-session')>('@/lib/console-session')
  return { ...actual, requestConsoleSessionJson: vi.fn().mockResolvedValue({}) }
})

import { persistConsoleShellSession, requestConsoleSessionJson } from '@/lib/console-session'
import type { ConsoleLoginSession } from '@/lib/console-auth'
import {
  deleteTenantIdentityProvider,
  getTenantAuthConfig,
  updateTenantAuthConfig,
  type TenantAuthConfig
} from './authConfigApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const base = '/v1/tenants/ten_1/auth-config'

const sampleConfig: TenantAuthConfig = {
  tenantId: 'ten_1',
  realm: 'ten-1-realm',
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  resetPasswordAllowed: false,
  rememberMe: false,
  verifyEmail: false,
  identityProviders: []
}

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue(sampleConfig)
})

describe('authConfigApi — tenant realm auth-config routes (#782)', () => {
  it('getTenantAuthConfig → GET …/auth-config', async () => {
    await getTenantAuthConfig('ten_1')
    expect(lastCall()).toEqual([base])
  })

  it('updateTenantAuthConfig → PUT …/auth-config with only the changed booleans', async () => {
    await updateTenantAuthConfig('ten_1', { verifyEmail: true })
    expect(lastCall()).toEqual([base, { method: 'PUT', body: { verifyEmail: true } }])
  })

  it('updateTenantAuthConfig can carry more than one boolean in a single patch', async () => {
    await updateTenantAuthConfig('ten_1', { verifyEmail: true, rememberMe: false })
    expect(lastCall()).toEqual([base, { method: 'PUT', body: { verifyEmail: true, rememberMe: false } }])
  })

  it('deleteTenantIdentityProvider → DELETE …/auth-config/identity-providers/{alias}', async () => {
    await deleteTenantIdentityProvider('ten_1', 'google')
    expect(lastCall()).toEqual([`${base}/identity-providers/google`, { method: 'DELETE' }])
  })

  it('encodes the tenant id and the identity-provider alias in the path', async () => {
    await deleteTenantIdentityProvider('ten/特', 'a b')
    expect(lastCall()).toEqual(['/v1/tenants/ten%2F%E7%89%B9/auth-config/identity-providers/a%20b', { method: 'DELETE' }])
  })
})

// --- Header inheritance from the real session HTTP layer (no per-call plumbing) -------------------
// Mirrors secretsApi.test.ts's "Part 2": verifies a mutating call automatically carries
// Idempotency-Key, X-API-Version, X-Correlation-Id, and the session Authorization bearer.
describe('authConfigApi — inherits session headers on mutations (no per-call construction)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const baseSession: ConsoleLoginSession = {
    sessionId: 'ses_auth_config',
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: '2026-03-28T18:00:00.000Z',
    lastActivityAt: '2026-03-28T18:00:00.000Z',
    expiresAt: '2026-03-28T20:00:00.000Z',
    idleExpiresAt: '2026-03-28T19:00:00.000Z',
    refreshExpiresAt: '2026-03-29T18:00:00.000Z',
    sessionPolicy: { maxLifetime: '8h', idleTimeout: '1h', refreshTokenMaxAge: '24h' },
    tokenSet: {
      accessToken: 'auth-config-bearer-token-123456',
      refreshToken: 'auth-config-refresh-token-123456',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 7200,
      scope: 'openid profile email',
      expiresAt: '2026-03-28T20:00:00.000Z',
      refreshExpiresAt: '2026-03-29T18:00:00.000Z'
    },
    principal: {
      userId: 'usr_owner',
      username: 'owner',
      displayName: 'Owner',
      primaryEmail: 'owner@example.com',
      state: 'active',
      platformRoles: ['tenant_owner'],
      workspaceIds: ['ws1']
    }
  }

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('PUT auth-config carries Idempotency-Key, X-API-Version, X-Correlation-Id and the bearer', async () => {
    const real = await vi.importActual<typeof import('@/lib/console-session')>('@/lib/console-session')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:00:00.000Z'))
    persistConsoleShellSession(baseSession)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await real.requestConsoleSessionJson('/v1/tenants/ten_1/auth-config', {
      method: 'PUT',
      body: { verifyEmail: true }
    })

    const [, requestInit] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(requestInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer auth-config-bearer-token-123456')
    expect(headers.get('X-API-Version')).toBeTruthy()
    expect(headers.get('X-Correlation-Id')).toBeTruthy()
    expect(headers.get('Idempotency-Key')).toBeTruthy()
  })
})
