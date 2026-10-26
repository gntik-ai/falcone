import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
import type { WorkspaceDocsResponse, WorkspaceDocNote } from '../../../src/pages/consoleDocs/api'

export const docsPath = '/v1/workspaces/wrk-1/docs'
export const note: WorkspaceDocNote = { noteId: 'note-1', content: 'customer checklist', authorId: 'synthetic-author-one', createdAt: '2026-05-30T09:00:00Z', updatedAt: '2026-05-30T09:00:00Z' }
export const secondNote: WorkspaceDocNote = { noteId: 'note-2', content: 'synthetic second checklist', authorId: 'synthetic-author-two', createdAt: '2026-05-30T10:00:00Z', updatedAt: '2026-05-30T11:00:00Z' }
export const createdNote: WorkspaceDocNote = { ...note, noteId: 'note-3', content: 'synthetic new note', createdAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:00Z' }
export const updatedNote: WorkspaceDocNote = { ...note, content: 'synthetic edited note', updatedAt: '2026-06-01T12:00:00Z' }
export const docs: WorkspaceDocsResponse = {
  workspaceId: 'wrk-1', tenantId: 'synthetic-tenant', generatedAt: '2026-05-30T08:00:00Z', baseUrl: 'https://api.example.test',
  authInstructions: { method: 'bearer_oidc', tokenEndpoint: 'https://iam.example.test/token', clientIdPlaceholder: '<YOUR_CLIENT_ID>', clientSecretPlaceholder: '<YOUR_CLIENT_SECRET>', scopeHint: 'openid', consoleRef: 'synthetic-console-reference' },
  enabledServices: [
    { serviceKey: 'postgres-database', category: 'synthetic-data', label: 'PostgreSQL', endpoint: 'postgresql://pg.example.test', port: 5432, resourceName: 'app_db', snippets: [
      { id: 's1', label: 'Node.js', code: 'const x = 1', hasPlaceholderSecrets: true, secretPlaceholderRef: 'synthetic-secret-reference' },
      { id: 's2', label: 'Python', code: 'synthetic_value = 2', hasPlaceholderSecrets: false, secretPlaceholderRef: null },
    ] },
    { serviceKey: 'synthetic-storage', category: 'synthetic-files', label: 'Synthetic storage', endpoint: 'https://storage.example.test', port: null, resourceName: null, snippets: [] },
  ], customNotes: [note, secondNote],
}
const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
export const docsFixtures = {
  'success-two-services-two-notes': ok(docs),
  'optional-fields-absent': ok({ ...docs, authInstructions: { ...docs.authInstructions, tokenEndpoint: null }, enabledServices: docs.enabledServices.map((service) => ({ ...service, port: 0 })) }),
  'no-notes': ok({ ...docs, customNotes: [] }),
  'no-services': ok({ ...docs, enabledServices: [] }),
  'long-values': ok({ ...docs, baseUrl: `https://api.example.test/${'synthetic-long-path'.repeat(20)}`, authInstructions: { ...docs.authInstructions, tokenEndpoint: `https://iam.example.test/${'synthetic-token-path'.repeat(20)}` }, enabledServices: docs.enabledServices.map((service) => ({ ...service, endpoint: `https://service.example.test/${'synthetic-endpoint'.repeat(20)}`, snippets: service.snippets.map((snippet) => ({ ...snippet, code: `synthetic_command ${'synthetic-long-argument'.repeat(20)}` })) })) }),
  'verbatim': ok({ ...docs, authInstructions: { ...docs.authInstructions, consoleRef: 'Settings' }, enabledServices: docs.enabledServices.map((service, index) => index === 0 ? { ...service, endpoint: 'pg.example.test' } : service) }),
  '403': { status: 403, body: { code: 'FORBIDDEN', message: 'synthetic-workspace-denial' } },
  '404': { status: 404, body: { code: 'NOT_FOUND' } },
  '500': { status: 500, body: { code: 'HTTP_500', requestId: 'synthetic-docs-request', message: 'synthetic-failure' } },
  '401': { status: 401, body: { code: 'UNAUTHORIZED' } },
  'network': { network: true },
}
export const docsEndpoints: Record<string, PageEndpoint> = {
  'workspace-docs.get': { method: 'GET', path: docsPath, fixtures: { success: ok(docs), empty: docsFixtures['no-notes'], ...docsFixtures } },
  'workspace-docs.notes.post': { method: 'POST', path: `${docsPath}/notes`, fixtures: { success: ok(createdNote), '500': { status: 500, body: { code: 'HTTP_500' } } } },
  'workspace-docs.notes.put': { method: 'PUT', path: `${docsPath}/notes/${note.noteId}`, fixtures: { success: ok(updatedNote), '500': { status: 500, body: { code: 'HTTP_500' } } } },
  'workspace-docs.notes.delete': { method: 'DELETE', path: `${docsPath}/notes/${note.noteId}`, fixtures: { success: ok(null), '500': { status: 500, body: { code: 'HTTP_500' } } } },
}
const manifest: ParityManifest = {
  route: '/console/workspaces/wrk-1/docs', roles: ['workspace_admin', 'workspace_viewer'], endpoints: docsEndpoints, fixtures: Object.keys(docsEndpoints),
  sources: ['src/pages/consoleDocs.tsx', 'src/pages/consoleDocs'],
  data: [{ name: 'base URL', locator: 'dd:has-text("https://api.example.test")' }, { name: 'method', locator: 'dd:text-is("bearer_oidc")' }],
  actions: [{ name: 'refresh', trigger: [{ es: 'button:text-is("Actualizar")', en: 'button:text-is("Refresh")' }], expected: { method: 'GET', path: docsPath }, outcome: 'dd:text-is("bearer_oidc")' }],
  states: [
    { fixture: 'workspace-docs.get', variant: 'empty', locator: { es: 'h3:text-is("No hay notas todavía.")', en: 'h3:text-is("No notes yet.")' } },
    { fixture: 'workspace-docs.get', variant: '403', locator: { es: 'h2:text-is("No tienes acceso a esta área de trabajo.")', en: 'h2:text-is("You do not have access to this workspace.")' } },
    { fixture: 'workspace-docs.get', variant: '404', locator: { es: 'h2:text-is("Área de trabajo no encontrada")', en: 'h2:text-is("Workspace not found")' } },
    ...(['500', 'network'] as const).map((variant) => ({ fixture: 'workspace-docs.get', variant, locator: { es: 'h2:text-is("No se pudo cargar la documentación.")', en: 'h2:text-is("Could not load the documentation.")' } })),
  ],
}
export default manifest
