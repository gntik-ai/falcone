import type { EndpointFixture, EndpointResponse, ParityManifest } from '../manifest'

export const secretPath = 'platform/db-password'
export const base = '/v1/platform/secrets/platform/db-password'
export const route = '/console/secrets/platform%2Fdb-password/rotate'
export const syntheticValue = 'synthetic-rotation-value-only'
export const history = { items: [
  { event_type: 'initiated', actor_id: 'synthetic-actor-a', occurred_at: '2026-06-01T10:00:00Z', vault_version_new: 3, vault_version_old: 2 },
  { eventType: 'completed', actorId: 'synthetic-actor-b', occurredAt: '2026-06-01T11:00:00Z', vaultVersionNew: 4, vaultVersionOld: 3 }, {},
], total: 3 }
export const mixed = { consumers: [
  { consumer_id: 'synthetic-apisix', reload_mechanism: 'api_reload', state: 'confirmed' },
  { consumer_id: 'synthetic-worker', reload_mechanism: 'restart', state: 'pending' },
  { consumer_id: 'synthetic-function', reload_mechanism: 'webhook', state: 'timeout' },
] }
export const pending = { consumers: [mixed.consumers[1]] }
export const confirmed = { consumers: [{ ...mixed.consumers[1], state: 'confirmed' }] }
export const timedOut = { consumers: [{ ...mixed.consumers[1], state: 'timeout' }] }
export const rotationResult = { rotationId: 'synthetic-rotation', vaultVersionNew: 8, vaultVersionOld: 7, gracePeriodSeconds: 3600, graceExpiresAt: '2026-06-01T13:00:00Z' }
export const failure = (status: number, requestId: string | undefined = 'req_synthetic_rotation'): EndpointResponse => ({ status, body: { code: `HTTP_${status}`, message: 'synthetic-rotation-error', ...(requestId ? { requestId } : {}) } })
export const historyFixtures: Record<string, EndpointFixture | EndpointFixture[]> = {
  success: { body: history }, 'rotation-history': { body: history },
  'rotation-history-page1': { body: { items: history.items, total: 45 } },
  'rotation-history-page2': { body: { items: [{ eventType: 'synthetic-page-two', actorId: 'synthetic-actor-page-two' }], total: 45 } },
  'rotation-history-page2-500-then-ok': [{ body: { ...history, total: 45 } }, failure(500), { body: { items: [{ eventType: 'synthetic-page-two' }], total: 45 } }],
  'rotation-delayed': { body: history, delayMs: 1500 }, 'rotation-history-empty': { body: { items: [], total: 0 } },
  'rotation-401': failure(401), 'rotation-403': failure(403), 'rotation-history-404': failure(404), 'rotation-history-500': failure(500),
  'rotation-history-500-no-id': failure(500, ''), 'rotation-network': { network: true },
}
export const consumerFixtures: Record<string, EndpointFixture | EndpointFixture[]> = {
  success: { body: mixed }, 'rotation-consumers-mixed': { body: mixed }, 'rotation-consumers-empty': { body: { consumers: [] } },
  'rotation-consumers-pending-then-confirmed': [{ body: pending }, { body: confirmed }], 'rotation-consumers-all-timeout': { body: timedOut },
  'rotation-consumers-500-then-ok': [{ body: mixed }, failure(500), { body: pending }],
  'rotation-consumers-network-then-ok': [{ body: mixed }, { network: true }, { body: pending }],
  'rotation-delayed': { body: mixed, delayMs: 1500 }, 'rotation-401': failure(401), 'rotation-403': failure(403), 'rotation-consumers-404': failure(404),
}
export const rotateFixtures: Record<string, EndpointFixture> = {
  success: { body: rotationResult }, 'rotation-rotate-ok': { body: rotationResult },
  'rotation-rotate-echo': (_role, body) => ({ body: { ...rotationResult, vaultVersionNew: (body as { gracePeriodSeconds: number }).gracePeriodSeconds === 0 ? 9 : 8 } }),
  'rotation-rotate-slow': { body: rotationResult, delayMs: 1500 }, 'rotation-rotate-slow-500': { ...failure(500), delayMs: 1500 },
  'rotation-rotate-400': failure(400), 'rotation-rotate-403': failure(403), 'rotation-rotate-404': failure(404), 'rotation-rotate-500': failure(500), 'rotation-rotate-503': failure(503), 'rotation-rotate-network': { network: true },
}
const manifest: ParityManifest = {
  route, roles: ['superadmin', 'tenant_viewer'], endpoints: {
    rotationHistory: { method: 'GET', path: `${base}/history`, fixtures: historyFixtures },
    rotationConsumers: { method: 'GET', path: `${base}/consumer-status`, fixtures: consumerFixtures },
    rotationSubmit: { method: 'POST', path: `${base}/rotate`, fixtures: rotateFixtures },
  },
  fixtures: ['shell-superadmin', ...new Set([...Object.keys(historyFixtures), ...Object.keys(consumerFixtures), ...Object.keys(rotateFixtures)])],
  sources: ['src/pages/consoleSecretRotation.tsx', 'src/pages/consoleSecretRotation'],
  data: [{ name: 'decoded path', locator: 'text=platform/db-password' }], actions: [], states: [],
}
export default manifest
