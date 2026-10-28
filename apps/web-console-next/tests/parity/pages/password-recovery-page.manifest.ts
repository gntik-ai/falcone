import type { ParityManifest } from '../manifest'
import { buildConsolePasswordRecoveryFixture } from '@in-falcone/console-api/fixtures'

export const recoveryPath = '/v1/auth/password-recovery-requests'
// Preserve the accepted legacy ticket fields with synthetic request identifiers.
export const recoveryTicket = { ...buildConsolePasswordRecoveryFixture(), maskedDestination: 'o***@example.com', requestedAt: '2026-07-01T12:00:00.000Z', expiresAt: '2026-07-01T12:30:00.000Z' }
const accepted = (status: typeof recoveryTicket.status) => ({ status: 202, body: { ...recoveryTicket, status, message: 'RAW_SERVER_MESSAGE' } })
const failure = (status: number) => ({ status, body: { status, code: `HTTP_${status}`, message: 'RAW_SERVER_MESSAGE', ...(status === 500 ? { requestId: 'synthetic-recovery-request' } : {}) } })
const manifest: ParityManifest = {
  route: '/password-recovery', roles: ['superadmin', 'tenant_viewer'], sources: ['src/pages/recovery.tsx'],
  endpoints: {
    recovery: { method: 'POST', path: recoveryPath, fixtures: {
      success: accepted('delivered'), delivered: accepted('delivered'), 'pending-delivery': accepted('pending_delivery'), completed: accepted('completed'), expired: accepted('expired'),
      delayed: { ...accepted('delivered'), delayMs: 1500 },
      '400': failure(400), '401': failure(401), '403': failure(403), '404': failure(404), '429': failure(429), '500': failure(500),
      network: { network: true }, '500-then-success': [failure(500), accepted('delivered')],
    } },
  },
  fixtures: ['delivered', 'pending-delivery', 'delayed', '400', '401', '403', '404', '429', '500', 'network', '500-then-success'].map((name) => `auth.password-recovery.${name}`),
  data: [{ name: 'recovery heading', locator: { es: 'h1:text-is("Recupera el acceso a In Falcone Console")', en: 'h1:text-is("Recover access to In Falcone Console")' } }],
  actions: [], states: [],
}
export default manifest
