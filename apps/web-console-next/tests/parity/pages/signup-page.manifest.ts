import type { ParityManifest } from '../manifest'

export const policyPath = '/v1/auth/signups/policy'
export const signupPath = '/v1/auth/signups'
// Same synthetic registration and status fixtures as console-auth-flows.e2e.ts.
export const pending = {
  registrationId: 'reg_console_001', userId: 'usr_pending_001', activationMode: 'approval_required',
  state: 'pending_activation', statusView: 'pending_activation', createdAt: '2026-03-28T21:05:00.000Z',
  message: 'Tu registro está pendiente de activación.',
}
export const active = { ...pending, activationMode: 'self_service', state: 'active', statusView: 'login', message: 'Synthetic active registration' }
export const pendingView = { statusView: 'pending_activation', title: 'Tu registro está pendiente de activación', message: 'Hemos recibido tu solicitud de acceso y todavía requiere aprobación.', allowedActions: [] }
const failure = (status: number) => ({ status, body: { status, code: `HTTP_${status}`, message: 'Synthetic signup failure', requestId: status === 500 ? 'synthetic-signup-request' : undefined } })
const manifest: ParityManifest = {
  route: '/signup', roles: ['tenant_owner'], sources: ['src/pages/signup.tsx', 'src/pages/signupFeedback.tsx'],
  endpoints: {
    signup: { method: 'POST', path: signupPath, fixtures: {
      success: { status: 201, body: pending }, active: { status: 201, body: active },
      statusPending: { status: 201, body: { ...pending, state: 'active' } },
      longActive: { status: 201, body: { ...active, registrationId: `reg_${'synthetic'.repeat(40)}`, message: 'Synthetic long message '.repeat(40) } },
      ...Object.fromEntries([400, 401, 403, 404, 409, 422, 500].map((status) => [String(status), failure(status)])), network: { network: true },
    } },
    pendingSignup: { method: 'GET', path: '/v1/auth/status-views/pending_activation', fixtures: { success: { status: 200, body: pendingView } } },
  },
  fixtures: ['auth.signups-policy.enabled', 'auth.signups-policy.disabled', 'auth.signups-policy.delayed', 'auth.signups.active', 'auth.signups.pending-activation', 'auth.signups.status-pending', 'auth.signups-policy.401', 'auth.signups.401', 'auth.signups.403', 'auth.signups.404', 'auth.signups.409', 'auth.signups.500', 'auth.signups.network'],
  data: [{ name: 'signup heading', locator: { es: 'h1:text-is("Crea tu acceso a In Falcone Console")', en: 'h1:text-is("Create your access to In Falcone Console")' } }],
  actions: [], states: [],
}
export default manifest
