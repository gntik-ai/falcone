import type {
  ConsoleAccountStatusView,
  ConsoleLoginSession,
  ConsolePasswordRecoveryTicket,
  ConsoleSessionTerminationAccepted,
  ConsoleSignupPolicy,
  ConsoleSignupRegistration
} from './auth'
import type { Tenant, TenantCollectionResponse, Workspace, WorkspaceCollectionResponse } from './types'

export interface PlatformSecretInventoryRow {
  secretPath: string
  name: string
  domain: string
  tenant: string
  state: 'active' | 'grace'
  lastRotated: string
  vaultVersion: number
  requiresForce: boolean
}

// Static metadata source for the interim platform secrets inventory. No secret material.
export function buildPlatformSecretInventoryFixture(): PlatformSecretInventoryRow[] {
  return [
    { secretPath: 'platform/postgresql/app-password', name: 'app-password', domain: 'platform', tenant: '—', state: 'active', lastRotated: '2026-03-31T00:00:00Z', vaultVersion: 2, requiresForce: false },
    { secretPath: 'tenant/tenant-a/db-password', name: 'db-password', domain: 'organización', tenant: 'org-a', state: 'grace', lastRotated: '2026-03-30T12:00:00Z', vaultVersion: 1, requiresForce: true }
  ]
}

// Every invocation returns a fresh object. All identities and credentials are synthetic.
export function buildConsoleSignupPolicyFixture(): ConsoleSignupPolicy {
  return {
    selfServiceEnabled: true, mode: 'self_service', statusView: 'signup',
    passwordPolicy: { minLength: 12 }, message: 'Synthetic signup policy'
  }
}

export function buildConsoleLoginSessionFixture(): ConsoleLoginSession {
  return {
    sessionId: 'synthetic-session', authenticationState: 'active', statusView: 'active',
    issuedAt: '2026-01-01T00:00:00.000Z', lastActivityAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z', idleExpiresAt: '2099-01-01T00:00:00.000Z',
    refreshExpiresAt: '2099-01-02T00:00:00.000Z',
    sessionPolicy: { maxLifetime: 'PT8H', idleTimeout: 'PT1H', refreshTokenMaxAge: 'P1D' },
    tokenSet: {
      accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token', tokenType: 'Bearer',
      expiresAt: '2099-01-01T00:00:00.000Z', expiresIn: 3600,
      refreshExpiresAt: '2099-01-02T00:00:00.000Z', refreshExpiresIn: 86400, scope: 'openid profile email'
    },
    principal: {
      userId: 'synthetic-user', username: 'synthetic-user', displayName: 'Synthetic Operator',
      primaryEmail: 'synthetic@example.test', state: 'active', platformRoles: ['tenant_owner'],
      tenantIds: ['synthetic-tenant'], workspaceIds: ['synthetic-workspace']
    }
  }
}

export function buildConsoleRefreshSessionFixture(): ConsoleLoginSession {
  const session = buildConsoleLoginSessionFixture()
  session.tokenSet!.accessToken = 'synthetic-refreshed-access-token'
  return session
}

export function buildConsoleSessionTerminationFixture(): ConsoleSessionTerminationAccepted {
  return { sessionId: 'synthetic-session', status: 'accepted', acceptedAt: '2026-01-01T00:00:00.000Z' }
}

export function buildConsoleSignupFixture(): ConsoleSignupRegistration {
  return {
    registrationId: 'synthetic-registration', userId: 'synthetic-user', activationMode: 'approval_required',
    state: 'pending_activation', statusView: 'pending_activation', createdAt: '2026-01-01T00:00:00.000Z',
    message: 'Synthetic registration', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace'
  }
}

export function buildConsolePasswordRecoveryFixture(): ConsolePasswordRecoveryTicket {
  return {
    recoveryRequestId: 'synthetic-recovery', status: 'pending_delivery', statusView: 'password_recovery',
    requestedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    maskedDestination: 'synthetic@example.test',
    credentialPolicy: { passwordMaxAge: 'P90D', gracePeriod: 'P7D', recoveryTokenTtl: 'PT15M' }
  }
}

export function buildConsoleAccountStatusViewFixture(): ConsoleAccountStatusView {
  return { statusView: 'active', title: 'Synthetic account', message: 'Synthetic status', allowedActions: [] }
}

export function buildTenantFixture(): Tenant {
  return { tenantId: 'synthetic-tenant', displayName: 'Synthetic Tenant', slug: 'synthetic-tenant', state: 'active' }
}

export function buildTenantCollectionFixture(): TenantCollectionResponse {
  return { items: [buildTenantFixture()], page: { after: null } }
}

export function buildWorkspaceFixture(): Workspace {
  return {
    workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace',
    slug: 'synthetic-workspace', environment: 'dev', state: 'active'
  }
}

export function buildWorkspaceCollectionFixture(): WorkspaceCollectionResponse {
  return { items: [buildWorkspaceFixture()], page: { after: null } }
}
