import type { ParityManifest } from '../manifest'
import { buildConsoleLoginSessionFixture } from '@in-falcone/console-api/fixtures'

export const loginPath = '/v1/auth/login-sessions'
export const pendingPath = '/v1/auth/status-views/pending_activation'
export const expiredPath = '/v1/auth/status-views/credentials_expired'
export const statusView = { statusView: 'pending_activation', title: 'RAW_SERVER_TITLE', message: 'RAW_SERVER_MESSAGE', allowedActions: [] }
export const expiredView = { statusView: 'credentials_expired', title: 'RAW_SERVER_TITLE', message: 'RAW_SERVER_MESSAGE', allowedActions: [{ actionId: 'recover_password', label: 'RAW_SERVER_LABEL', target: '/password-recovery?source=status#recover' }] }
const failure = (status: number, requestId?: string) => ({ status, body: { status, code: `HTTP_${status}`, message: 'RAW_SERVER_MESSAGE', requestId } })
const conflict = (statusView: string) => ({ status: 409, body: { status: 409, code: 'ACCOUNT_RESTRICTED', detail: { statusView }, message: 'RAW_SERVER_MESSAGE' } })
const manifest: ParityManifest = {
  route: '/login', roles: ['superadmin', 'tenant_viewer'], sources: ['src/pages/login.tsx'],
  endpoints: {
    login: { method: 'POST', path: loginPath, fixtures: {
      success: (role) => { const body = buildConsoleLoginSessionFixture(); body.principal!.platformRoles = [role]; return { status: 200, body } },
      'auth.login-sessions.409-pending-activation': conflict('pending_activation'),
      'auth.login-sessions.409-credentials-expired': conflict('credentials_expired'),
      '400': failure(400), '401': failure(401), '403': failure(403), '500': failure(500, 'synthetic-login-request'), network: { network: true },
    } },
    pending: { method: 'GET', path: pendingPath, fixtures: {
      success: { status: 200, body: statusView }, '401': failure(401), '403': failure(403), '404': failure(404),
      '500': failure(500, 'synthetic-status-request'), '500-no-request-id': failure(500), network: { network: true },
    } },
    expired: { method: 'GET', path: expiredPath, fixtures: { success: { status: 200, body: expiredView } } },
  },
  fixtures: ['auth.signups-policy.enabled', 'auth.signups-policy.disabled', 'session.status-hint', 'session.protected-intent', 'session.stored-refreshable', 'session.stored-refresh-rejected', 'auth.login-sessions.success', 'auth.login-sessions.success-read-only',
    'auth.login-sessions.409-pending-activation', 'auth.login-sessions.409-credentials-expired', 'auth.status-views.pending-activation', 'auth.status-views.credentials-expired',
    ...['401', '403', '404', '500', 'network'].flatMap((status) => [`auth.signups-policy.${status}`, `auth.status-views.${status}`]),
    'auth.signups-policy.delayed', 'auth.login-sessions.401', 'auth.login-sessions.403', 'auth.login-sessions.500', 'auth.login-sessions.network',
    'auth.login-sessions.500-then-success', 'auth.signups-policy.500-then-success', 'auth.status-views.500-then-success', 'auth.status-views.network-then-success', 'auth.status-views.500-no-request-id'],
  data: [{ name: 'login heading', locator: { es: 'h1:text-is("Accede a In Falcone Console")', en: 'h1:text-is("Sign in to In Falcone Console")' } }],
  actions: [], states: [],
}
export default manifest
