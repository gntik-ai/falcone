import type { ParityManifest } from '../manifest'

export const workspaceId = 'synthetic-workspace'
export const apiKey = 'synthetic-anon-key'
export const mongoPath = `/v1/realtime/workspaces/${workspaceId}/data/app_db/collections/orders/changes?apikey=${apiKey}`
export const pgPath = `/v1/realtime/workspaces/${workspaceId}/data/app_db/schemas/public/tables/accounts/changes?apikey=${apiKey}`

// One scripted connection of the page-local stream client. The harness serves JSON only, so the
// spec replaces window.fetch for /v1/realtime/ URLs with these scripts (real Response and
// ReadableStream objects; only the network layer is mocked).
export interface StreamScript {
  status?: number
  body?: unknown
  // Delay the response until the spec releases it.
  withhold?: boolean
  frames?: string[]
  // Frames released on demand once the stream is open.
  held?: string[]
  // Close the stream after the frames (a dropped connection).
  end?: boolean
}
const frame = (event: string, document: Record<string, unknown>) =>
  `event: ${event}\ndata: ${JSON.stringify({ type: event, documentId: document._id, document })}\n\n`
const order = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, ...extra })
// A long retry keeps the reconnect pending for the whole test, like a frozen clock.
const heldReconnect = 'retry: 600000\n\n'
const threeFrames = [frame('insert', order('o1', { total: 10 })), frame('update', order('o2', { total: 20 })), frame('replace', order('o3', { total: 30 }))]
const failure = (status: number, requestId?: string): StreamScript => ({ status, body: { status, code: `HTTP_${status}`, message: 'synthetic-error', ...(requestId ? { requestId } : {}) } })
const accepted: StreamScript = { frames: [frame('insert', order('o1'))] }

export const streamFixtures: Record<string, StreamScript[]> = {
  'realtime-sse-mongo': [{ frames: threeFrames, held: [frame('delete', order('o4'))] }],
  'realtime-sse-pg': [{ frames: [frame('insert', { id: 1, name: 'synthetic-a' }), frame('update', { id: 1, name: 'synthetic-b' }), frame('delete', { id: 1 })] }],
  'realtime-sse-101-events': [{ frames: Array.from({ length: 101 }, (_, index) => frame('insert', order(`n${index + 1}`))) }],
  'realtime-sse-malformed': [{ frames: [frame('insert', order('a')), 'event: insert\ndata: {broken\n\n', 'event: ping\ndata: {"type":"insert"}\n\n', frame('update', order('b'))] }],
  'realtime-sse-burst': [{ frames: Array.from({ length: 50 }, (_, index) => frame('insert', order(`b${index + 1}`))) }],
  'realtime-sse-delayed': [{ withhold: true, frames: [frame('insert', order('o1'))] }],
  'realtime-sse-idle': [{ frames: [], held: [frame('insert', order('o1'))] }],
  'realtime-sse-drop': [{ frames: [...threeFrames, heldReconnect], end: true }, { frames: [frame('insert', order('o5'))] }],
  'realtime-sse-drop-retry': [{ frames: [...threeFrames, heldReconnect], end: true }, { frames: [frame('insert', order('r1')), frame('insert', order('r2'))] }],
  'realtime-sse-401': [failure(401)],
  'realtime-sse-403': [failure(403)],
  'realtime-sse-404': [failure(404)],
  'realtime-sse-500': [failure(500, 'synthetic-request-id'), accepted],
  'realtime-sse-500-no-id': [failure(500)],
}

// Allowed presentation differences from legacy; the request URL and the 100-change cap are unchanged.
export const allowedDifferences = ['anon key masked', 'status dot', 'stale markers', 'json viewer', 'change selector', 'reintentar', 'no-access and not-found states']

const manifest: ParityManifest = {
  route: '/console/realtime/changes', roles: ['superadmin'], fixtures: [],
  sources: ['src/pages/consoleRealtimeChanges.tsx', 'src/pages/consoleRealtimeChanges'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Cambios en tiempo real")', en: 'h1:text-is("Realtime changes")' } }],
  actions: [], states: [],
}
export default manifest
