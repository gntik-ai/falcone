import { sessionFor } from './shell'

export function profileSession(variant: 'populated' | 'empty' | 'expired' | 'long-email' = 'populated') {
  const session = sessionFor('tenant_owner')
  session.principal!.platformRoles = ['tenant_admin', 'platform_auditor']
  if (variant === 'empty') {
    session.principal!.platformRoles = []
    Object.assign(session.principal!, { displayName: undefined, username: undefined, primaryEmail: undefined })
  }
  if (variant === 'expired') {
    session.tokenSet!.expiresAt = '2026-01-01T00:00:00.000Z'
    session.expiresAt = session.tokenSet!.expiresAt
  }
  if (variant === 'long-email') session.principal!.primaryEmail = `${'synthetic.'.repeat(20)}operator@example.test`
  return session
}
