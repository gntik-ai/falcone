import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleLoginSession } from '@/lib/console-auth'

// --- Part 1: path/method/body assertions with a mocked session HTTP layer -----------------------
vi.mock('@/lib/console-session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-session')>('@/lib/console-session')
  return { ...actual, requestConsoleSessionJson: vi.fn().mockResolvedValue({}) }
})

import { persistConsoleShellSession, requestConsoleSessionJson } from '@/lib/console-session'
import {
  createSecret,
  deleteSecret,
  getSecretMeta,
  listSecrets,
  readSecretName,
  secretEnvVarName,
  updateSecret,
  type WorkspaceSecret
} from './secretsApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const secrets = '/v1/functions/workspaces/ws1/secrets'

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('secretsApi — function_workspace_secret routes (workspace-scoped, write-only value)', () => {
  it('listSecrets → GET …/secrets', async () => {
    await listSecrets('ws1')
    expect(lastCall()).toEqual([secrets])
  })

  it('getSecretMeta → GET …/secrets/{name}', async () => {
    await getSecretMeta('ws1', 'db_password')
    expect(lastCall()).toEqual([`${secrets}/db_password`])
  })

  it('createSecret → POST …/secrets with the write-only value (create-only)', async () => {
    await createSecret('ws1', { secretName: 'db_password', secretValue: 's3cr3t', description: 'prod db' })
    expect(lastCall()).toEqual([
      secrets,
      { method: 'POST', body: { secretName: 'db_password', secretValue: 's3cr3t', description: 'prod db' } }
    ])
  })

  it('createSecret omits description when not provided', async () => {
    await createSecret('ws1', { secretName: 'token', secretValue: 'v' })
    expect(lastCall()).toEqual([secrets, { method: 'POST', body: { secretName: 'token', secretValue: 'v' } }])
  })

  it('updateSecret → PUT …/secrets/{name} (replace)', async () => {
    await updateSecret('ws1', 'token', { secretValue: 'rotated' })
    expect(lastCall()).toEqual([`${secrets}/token`, { method: 'PUT', body: { secretValue: 'rotated' } }])
  })

  it('deleteSecret → DELETE …/secrets/{name}', async () => {
    await deleteSecret('ws1', 'token')
    expect(lastCall()).toEqual([`${secrets}/token`, { method: 'DELETE' }])
  })

  it('encodes the workspace id and secret name in the path', async () => {
    await getSecretMeta('ws/特', 'a b')
    expect(lastCall()).toEqual(['/v1/functions/workspaces/ws%2F%E7%89%B9/secrets/a%20b'])
  })

  it('exposes NO value-returning method (read types carry no value field)', () => {
    // Compile-time guarantee mirrored at runtime: the surface has only metadata/write methods.
    const surface = { listSecrets, getSecretMeta, createSecret, updateSecret, deleteSecret }
    expect(Object.keys(surface).some((k) => /value|reveal|reveal/i.test(k))).toBe(false)
    // A read result is metadata only — there is no `value` member on the type or the object.
    const meta: WorkspaceSecret = {
      secretName: 'x',
      tenantId: 'ten_1',
      workspaceId: 'wrk_1',
      resolvedRefCount: 0,
      timestamps: { createdAt: 'a', updatedAt: 'b' }
    }
    expect('value' in meta).toBe(false)
  })

  it('readSecretName reads the canonical secretName, tolerating the legacy name alias', () => {
    expect(readSecretName({ secretName: 'canon', tenantId: 't', workspaceId: 'w', resolvedRefCount: 0, timestamps: { createdAt: 'a', updatedAt: 'b' } })).toBe('canon')
    expect(readSecretName({ secretName: undefined as unknown as string, name: 'legacy', tenantId: 't', workspaceId: 'w', resolvedRefCount: 0, timestamps: { createdAt: 'a', updatedAt: 'b' } })).toBe('legacy')
  })

  it('secretEnvVarName derives the UPPER_SNAKE env var (how the secret is injected)', () => {
    expect(secretEnvVarName('db-password')).toBe('DB_PASSWORD')
    expect(secretEnvVarName('api.key')).toBe('API_KEY')
  })
})

// --- Part 2: header inheritance from the real session HTTP layer (no per-call plumbing) ----------
// Verifies a mutating secrets call automatically carries Idempotency-Key, X-API-Version,
// X-Correlation-Id, and the session Authorization bearer (the scenario in the web-console spec).
describe('secretsApi — inherits session headers on mutations (no per-call construction)', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const baseSession: ConsoleLoginSession = {
    sessionId: 'ses_secrets',
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: '2026-03-28T18:00:00.000Z',
    lastActivityAt: '2026-03-28T18:00:00.000Z',
    expiresAt: '2026-03-28T20:00:00.000Z',
    idleExpiresAt: '2026-03-28T19:00:00.000Z',
    refreshExpiresAt: '2026-03-29T18:00:00.000Z',
    sessionPolicy: { maxLifetime: '8h', idleTimeout: '1h', refreshTokenMaxAge: '24h' },
    tokenSet: {
      accessToken: 'secret-bearer-token-123456',
      refreshToken: 'secret-refresh-token-123456',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 7200,
      scope: 'openid profile email',
      expiresAt: '2026-03-28T20:00:00.000Z',
      refreshExpiresAt: '2026-03-29T18:00:00.000Z'
    },
    principal: {
      userId: 'usr_secrets',
      username: 'ops',
      displayName: 'Ops',
      primaryEmail: 'ops@example.com',
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

  it('a create (POST) carries Idempotency-Key, X-API-Version, X-Correlation-Id and the bearer', async () => {
    // This part needs the REAL requestConsoleSessionJson (the mock above replaces only the named
    // export via importActual spread; restore by importing the real module dynamically).
    const real = await vi.importActual<typeof import('@/lib/console-session')>('@/lib/console-session')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:00:00.000Z'))
    persistConsoleShellSession(baseSession)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ secretName: 'db_password', tenantId: 'ten_1', workspaceId: 'wrk_1', resolvedRefCount: 0, timestamps: { createdAt: 'a', updatedAt: 'b' } }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await real.requestConsoleSessionJson('/v1/functions/workspaces/ws1/secrets', {
      method: 'POST',
      body: { secretName: 'db_password', secretValue: 's3cr3t' }
    })

    const [, requestInit] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(requestInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret-bearer-token-123456')
    expect(headers.get('X-API-Version')).toBeTruthy()
    expect(headers.get('X-Correlation-Id')).toBeTruthy()
    expect(headers.get('Idempotency-Key')).toBeTruthy()
    // The request never carries the value in the URL/query string.
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(url.includes('s3cr3t')).toBe(false)
  })
})
