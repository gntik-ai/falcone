import { requestConsoleSessionJson } from '@/lib/console-session'

export interface WorkspaceDocSnippet {
  id: string
  label: string
  code: string
  notes?: string[]
  hasPlaceholderSecrets: boolean
  secretPlaceholderRef: string | null
}

export interface WorkspaceDocService {
  serviceKey: string
  category: string
  label: string
  endpoint: string
  port: number | null
  resourceName: string | null
  snippets: WorkspaceDocSnippet[]
}

export interface WorkspaceDocNote {
  noteId: string
  content: string
  authorId: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceDocsResponse {
  workspaceId: string
  tenantId: string
  generatedAt: string
  baseUrl: string
  stale?: boolean
  authInstructions: {
    method: string
    tokenEndpoint: string | null
    clientIdPlaceholder: string
    clientSecretPlaceholder: string
    scopeHint: string
    consoleRef: string
  }
  enabledServices: WorkspaceDocService[]
  customNotes: WorkspaceDocNote[]
}

const WORKSPACE_DOC_NOTE_MANAGEMENT_ROLES = new Set(['workspace_admin', 'workspace_owner'])

export function canManageWorkspaceDocNotes(roles: readonly string[] | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => WORKSPACE_DOC_NOTE_MANAGEMENT_ROLES.has(role))
}

function workspaceDocsBase(workspaceId: string): string {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/docs`
}

export async function fetchWorkspaceDocs(workspaceId: string): Promise<WorkspaceDocsResponse> {
  return requestConsoleSessionJson<WorkspaceDocsResponse>(workspaceDocsBase(workspaceId))
}

export async function createDocNote(workspaceId: string, content: string): Promise<WorkspaceDocNote> {
  return requestConsoleSessionJson<WorkspaceDocNote>(`${workspaceDocsBase(workspaceId)}/notes`, {
    method: 'POST',
    body: { content }
  })
}

export async function updateDocNote(workspaceId: string, noteId: string, content: string): Promise<WorkspaceDocNote> {
  return requestConsoleSessionJson<WorkspaceDocNote>(`${workspaceDocsBase(workspaceId)}/notes/${encodeURIComponent(noteId)}`, {
    method: 'PUT',
    body: { content }
  })
}

export async function deleteDocNote(workspaceId: string, noteId: string): Promise<void> {
  await requestConsoleSessionJson(`${workspaceDocsBase(workspaceId)}/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE'
  })
}
