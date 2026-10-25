import type { PageEndpoint, ParityManifest } from '../manifest'

export const statusPath = '/v1/auth/status-views/pending_activation'
export const serverView = {
  statusView: 'pending_activation', title: 'RAW_SERVER_TITLE', message: 'RAW_SERVER_MESSAGE', allowedActions: [],
}
export const actionView = { ...serverView, allowedActions: [
  { actionId: 'start_login', label: 'RAW_SERVER_LABEL', target: '/login' },
  { actionId: 'create_account', label: 'RAW_SERVER_LABEL', target: '/signup' },
  { actionId: 'recover_password', label: 'RAW_SERVER_LABEL', target: '/password-recovery' },
] }
export const navigationFixtures = {
  'nav-state.signup-registration': {
    registrationId: 'reg_pending123', state: 'pending_activation', statusView: 'pending_activation',
    activationMode: 'approval_required', createdAt: '2026-03-28T19:10:00.000Z', message: 'RAW_NAVIGATION_MESSAGE',
  },
  'nav-state.signup-unknown-mode': { statusView: 'pending_activation', activationMode: 'unknown', message: 'RAW_NAVIGATION_MESSAGE' },
}
const ok = (body: unknown) => ({ status: 200, body })
const failure = (status: number) => ({ status, body: { status, message: 'RAW_ERROR_MESSAGE', requestId: status === 500 ? 'synthetic-pending-request' : undefined } })
export const statusFixtures = {
  success: ok(serverView), empty: ok(serverView),
  'auth.status-views.pending-activation': ok(serverView),
  'auth.status-views.pending-activation-with-actions': ok(actionView),
  'auth.status-views.unknown-action': ok({ ...serverView, allowedActions: [{ actionId: 'unknown', label: 'RAW_SERVER_LABEL', target: '/help?source=pending#support' }] }),
  'auth.status-views.unknown-status': ok({ ...serverView, statusView: 'unknown' }),
  'auth.status-views.no-actions': ok(serverView),
  'auth.status-views.delayed': { ...ok(serverView), delayMs: 1500 },
  'auth.status-views.401': failure(401), 'auth.status-views.403': failure(403),
  'auth.status-views.404': failure(404), 'auth.status-views.500': failure(500),
  'auth.status-views.network': { network: true },
  'auth.status-views.500-then-success': [failure(500), ok(actionView)],
  'auth.status-views.500-twice-then-success': [failure(500), failure(500), ok(actionView)],
}
export const pendingEndpoints: Record<string, PageEndpoint> = {
  pendingActivation: { method: 'GET', path: statusPath, fixtures: statusFixtures },
}
const manifest: ParityManifest = {
  route: '/signup/pending-activation', roles: ['tenant_viewer'], endpoints: pendingEndpoints,
  fixtures: [...Object.keys(statusFixtures), ...Object.keys(navigationFixtures)],
  sources: ['src/pages/pendingActivation.tsx'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Tu registro está pendiente de activación")', en: 'h1:text-is("Your registration is pending activation")' } }],
  actions: [{ name: 'retry status', trigger: [{ es: 'button:text-is("Reintentar")', en: 'button:text-is("Retry")' }], expected: { method: 'GET', path: statusPath }, outcome: 'main' }],
  states: [],
}
export default manifest
