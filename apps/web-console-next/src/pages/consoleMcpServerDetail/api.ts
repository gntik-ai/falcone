import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { JsonValue } from '@in-falcone/console-api/http'

export interface McpToolView {
  name: string
  description: string | null
  mutates: boolean
  scope: string | null
}

/** The control-plane payload shape (tolerant of the active-version envelope or a flat server). */
export interface McpServerDetailInput {
  id?: string | null
  name?: string | null
  slug?: string | null
  status?: string | null
  endpoint?: string | null
  endpointUrl?: string | null
  transport?: string | null
  source?: string | null
  version?: string | null
  activeVersion?: {
    version?: string | null
    source?: string | null
    tools?: Array<{ name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }>
  } | null
  tools?: Array<{ name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }>
  runtimeDependency?: { state?: string; reason?: string } | null
  runtimeReady?: boolean
}

export interface McpServerDetailView {
  id: string | null
  name: string | null
  slug: string | null
  endpoint: string | null
  status: string | null
  version: string | null
  source: string | null
  transport: string
  tools: McpToolView[]
  runtimeDependency: { state: string; reason: string } | null
  runtimeReady: boolean
}

function toToolView(t: { name: string; description?: string | null; mutates?: boolean; scope?: string | null; suggestedScope?: string | null }): McpToolView {
  return {
    name: t.name,
    description: t.description ?? null,
    mutates: !!t.mutates,
    scope: t.scope ?? t.suggestedScope ?? null
  }
}

/** Shape a control-plane server payload into the detail view-model (endpoint, version, tools). */
export function toMcpServerDetailViewModel(input: McpServerDetailInput = {}): McpServerDetailView {
  const active = input.activeVersion ?? null
  const rawTools = active?.tools ?? input.tools ?? []
  return {
    id: input.id ?? null,
    name: input.name ?? null,
    slug: input.slug ?? null,
    endpoint: input.endpointUrl ?? input.endpoint ?? null,
    status: input.status ?? null,
    version: active?.version ?? input.version ?? null,
    source: active?.source ?? input.source ?? null,
    transport: input.transport ?? 'streamable-http',
    tools: rawTools.map(toToolView),
    runtimeDependency: input.runtimeDependency ? { state: input.runtimeDependency.state ?? 'unknown', reason: input.runtimeDependency.reason ?? '' } : null,
    runtimeReady: input.runtimeReady !== false
  }
}


export interface InvokeMcpToolResult {
  result?: unknown
  error?: { code?: number; message?: string }
}
export const serverPath = (workspaceId: string, serverId: string) =>
  `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}`
export function fetchMcpServerDetail(workspaceId: string, serverId: string, signal?: AbortSignal) {
  return requestConsoleSessionJson<McpServerDetailInput>(serverPath(workspaceId, serverId), { signal })
}
export function invokeMcpTool(workspaceId: string, serverId: string, toolName: string, args: Record<string, JsonValue>, signal?: AbortSignal) {
  return requestConsoleSessionJson<InvokeMcpToolResult>(`${serverPath(workspaceId, serverId)}/tool-calls`, {
    method: 'POST', body: { name: toolName, arguments: args }, signal,
  })
}

// Generate exactly the legacy client configurations; all surrounding copy belongs to the catalog.
export function connectionSnippets(info: Pick<McpServerDetailView, 'slug' | 'name' | 'endpoint'>) {
  const slug = String(info.slug ?? info.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'
  const endpoint = info.endpoint ?? '<MCP_ENDPOINT>'
  return [
    { id: 'cursor', code: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(slug)}&config=${btoa(JSON.stringify({ url: endpoint }))}` },
    { id: 'claudeCode', code: JSON.stringify({ mcpServers: { [slug]: { type: 'http', url: endpoint } } }, null, 2) },
    { id: 'claudeAi', code: endpoint },
    { id: 'vscode', code: JSON.stringify({ servers: { [slug]: { type: 'http', url: endpoint } } }, null, 2) },
  ].map((snippet) => ({ ...snippet, slug, endpoint }))
}
