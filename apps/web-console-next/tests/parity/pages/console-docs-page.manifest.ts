import type { PageEndpoint, ParityManifest } from '../manifest'
import type { WorkspaceDocsResponse } from '../../../src/pages/consoleDocs/api'

export const note = {
  noteId: 'synthetic-note-1', content: 'Synthetic customer checklist', authorId: 'synthetic-author-1',
  createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-01T11:00:00Z',
}
export const secondNote = { ...note, noteId: 'synthetic-note-2', content: 'Synthetic rollout note', authorId: 'synthetic-author-2', createdAt: '2026-06-01T11:30:00Z', updatedAt: '2026-06-01T11:30:00Z' }
export const createdNote = { ...note, noteId: 'synthetic-note-3', content: '  Synthetic new note  ', createdAt: '2026-06-01T11:45:00Z', updatedAt: '2026-06-01T11:45:00Z' }
export const updatedNote = { ...note, content: 'Synthetic updated note', updatedAt: '2026-06-01T11:50:00Z' }
export const docs: WorkspaceDocsResponse = {
  workspaceId: 'wrk-1', tenantId: 'synthetic-tenant', baseUrl: 'https://synthetic-api.example.test/' + 'synthetic-path-'.repeat(12), generatedAt: '2026-06-01T09:00:00Z',
  authInstructions: { method: 'synthetic-bearer-oidc', tokenEndpoint: 'https://synthetic-iam.example.test/' + 'synthetic-token-'.repeat(12),
    clientIdPlaceholder: '<SYNTHETIC_CLIENT_ID>', clientSecretPlaceholder: '<SYNTHETIC_CLIENT_SECRET>', scopeHint: 'synthetic-openid', consoleRef: 'Synthetic workspace reference' },
  enabledServices: [
    { serviceKey: 'synthetic-sql', label: 'Synthetic SQL service', category: 'synthetic-database', endpoint: 'https://synthetic-sql.example.test/' + 'synthetic-endpoint-'.repeat(12), port: 5432, resourceName: null,
      snippets: [
        { id: 'synthetic-shell', label: 'Synthetic shell example', code: 'synthetic-connect --host synthetic-sql.example.test --client <SYNTHETIC_CLIENT_ID>', notes: [], hasPlaceholderSecrets: true, secretPlaceholderRef: 'Synthetic secret placeholder guidance' },
        { id: 'synthetic-sdk', label: 'Synthetic SDK example', code: 'syntheticClient.connect("synthetic-sql.example.test")', notes: [], hasPlaceholderSecrets: false, secretPlaceholderRef: null },
      ] },
    { serviceKey: 'synthetic-events', label: 'Synthetic event service', category: 'synthetic-stream', endpoint: 'https://synthetic-events.example.test', port: null, resourceName: null,
      snippets: [{ id: 'synthetic-curl', label: 'Synthetic curl example', code: 'synthetic-curl https://synthetic-events.example.test', notes: [], hasPlaceholderSecrets: false, secretPlaceholderRef: null }] },
  ],
  customNotes: [note, secondNote],
}
const ok = (body: unknown) => ({ status: 200, body })
export const docsFailure = { status: 500, body: { code: 'HTTP_500', message: 'synthetic-error', requestId: 'synthetic-docs-request' } }
export const optionalDocs = { ...docs, authInstructions: { ...docs.authInstructions, tokenEndpoint: null }, enabledServices: docs.enabledServices.map((service) => ({ ...service, port: 0 })) }
export const docsEndpoints: Record<string, PageEndpoint> = {
  'docs.get': { method: 'GET', path: '/v1/workspaces/wrk-1/docs', fixtures: {
    success: ok(docs), 'optional-fields-absent': ok(optionalDocs), empty: ok({ ...docs, customNotes: [] }), 'no-services': ok({ ...docs, enabledServices: [] }),
    verbatim: ok({ ...docs, authInstructions: { ...docs.authInstructions, consoleRef: 'Settings' } }), '500': docsFailure,
    '403': { status: 403, body: { code: 'FORBIDDEN', message: 'Synthetic access reason' } },
    '500-then-success': [docsFailure, ok(docs)],
    'missing-timestamps': ok({ ...docs, generatedAt: undefined, customNotes: [{ ...note, createdAt: undefined, updatedAt: undefined, authorId: undefined }] }),
  } },
  'docs.create': { method: 'POST', path: '/v1/workspaces/wrk-1/docs/notes', fixtures: { success: ok(createdNote), '500': docsFailure } },
  'docs.update': { method: 'PUT', path: `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, fixtures: { success: ok(updatedNote), '500': docsFailure } },
  'docs.delete': { method: 'DELETE', path: `/v1/workspaces/wrk-1/docs/notes/${note.noteId}`, fixtures: { success: ok({}), '500': docsFailure } },
}
const manifest: ParityManifest = {
  route: '/console/workspaces/wrk-1/docs', roles: ['workspace_admin', 'workspace_viewer'],
  endpoints: docsEndpoints, fixtures: Object.keys(docsEndpoints), sources: ['src/pages/consoleDocs.tsx', 'src/pages/consoleDocs/api.ts'],
  data: [{ name: 'heading', locator: { es: 'h1:text-is("Documentación del área de trabajo")', en: 'h1:text-is("Workspace documentation")' } }],
  actions: [], states: [
    { fixture: 'docs.get', variant: 'empty', locator: { es: 'h3:text-is("No hay notas todavía.")', en: 'h3:text-is("No notes yet.")' } },
    { fixture: 'docs.get', variant: '404', locator: { es: 'h2:text-is("Área de trabajo no encontrada")', en: 'h2:text-is("Workspace not found")' } },
    { fixture: 'docs.get', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a esta área de trabajo.")', en: 'h2:text-is("You do not have access to this workspace.")' } },
  ],
}
export default manifest
