import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
export const topicsPath = '/v1/events/workspaces/synthetic-workspace/topics'
export const publishPath = `${topicsPath}/synthetic-orders/publish`
export const messagesPath = `${topicsPath}/synthetic-orders/messages`
export const topics = { items: [{ topic: 'synthetic-orders', partitions: 3 }, { topic: 'synthetic-audit', partitions: 1 }, { topic: 'synthetic-no-partitions' }] }
export const createdTopics = { items: [...topics.items, { topic: 'synthetic-new', partitions: 1 }] }
export const messages = { status: 'complete' as const, items: [
  { key: 'synthetic-key', value: { event: 'synthetic-order', count: 1 }, partition: 0, offset: '42', timestamp: '2026-06-01T12:00:00Z' },
  { key: null, value: { event: 'synthetic-audit', text: 'synthetic-long-value-'.repeat(30) }, partition: 2, offset: '43', timestamp: '2026-06-01T12:01:00Z' },
] }
const failure = (status: number): EndpointResponse => ({ status, body: { status, code: `HTTP_${status}`, message: 'synthetic-error', requestId: `req_synthetic_events_${status}` } })
const endpoint = (method: string, path: string, fixtures: Record<string, EndpointResponse>): PageEndpoint => ({ method, path, fixtures })
export const eventsEndpoints = {
  'events-topics': endpoint('GET', topicsPath, { success: { body: topics }, 'success-three': { body: topics }, created: { body: createdTopics }, empty: { body: { items: [] } }, '401': failure(401), '403': failure(403), '500': failure(500), network: { network: true } }),
  'events-create': endpoint('POST', topicsPath, { success: { body: { topic: 'synthetic-new' } }, '403': failure(403), '500': failure(500) }),
  'events-publish': endpoint('POST', publishPath, { success: { body: { partition: 0, offset: 44 } }, '403': failure(403), '404': failure(404), '500': failure(500), network: { network: true } }),
  'events-messages': endpoint('GET', messagesPath, { success: { body: messages }, 'success-two': { body: messages }, empty: { body: { items: [], status: 'empty' } }, timeout: { body: { items: [], status: 'timeout', reason: 'assignment' } }, '404': failure(404), '500': failure(500), network: { network: true } }),
}
const manifest: ParityManifest = {
  route: '/console/events/data', roles: ['superadmin', 'workspace_viewer'], endpoints: eventsEndpoints,
  fixtures: ['events.topics.success-three', 'events.messages.success-two', 'events.topics.post.success', 'events.publish.success', 'events.topics.empty', 'events.messages.empty', 'events.messages.timeout', 'events.topics.401', 'events.topics.403', 'events.publish.403', 'events.messages.404', 'events.publish.404', 'events.topics.500', 'events.topics.network', 'shell.workspace-admin', 'shell.workspace-viewer', 'shell.no-workspace'],
  sources: ['src/pages/consoleEventsData.tsx', 'src/pages/consoleEventsData'],
  data: [{ name: 'events-title', locator: '[data-testid="console-events-data-page"] h1' }], actions: [], states: [],
}
export default manifest
