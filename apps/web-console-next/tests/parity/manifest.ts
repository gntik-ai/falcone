export type Role = 'superadmin' | 'tenant_owner' | 'tenant_viewer' | 'workspace_admin' | 'workspace_viewer'
export type Variant = 'success' | 'empty' | '401' | '403' | '404' | '500' | 'network'
export type Locator = string | { es: string; en: string }
export interface EndpointResponse { status?: number; body?: unknown; network?: boolean; delayMs?: number }
export type EndpointFixture = EndpointResponse | ((role: Role, body?: unknown) => EndpointResponse)
export interface PageEndpoint {
  method: string
  path: string
  // Match a flat body discriminator; overlapping endpoint registrations still fail closed.
  requestBody?: Record<string, string>
  fixtures: Record<string, EndpointFixture | EndpointFixture[]>
}
export type EndpointVariant = string | { variant?: string; delayMs?: number }
export type EndpointVariants = Record<string, EndpointVariant | EndpointVariant[]>
export interface ParityManifest {
  endpoints?: Record<string, PageEndpoint>
  route: string
  roles: Role[]
  fixtures: string[]
  sources: string[]
  data: { name: string; locator: Locator }[]
  actions: {
    name: string
    trigger: Locator[]
    expected: { method: string; path: string; body?: unknown }
    outcome: Locator
  }[]
  states: { fixture: string; variant: Exclude<Variant, 'success'>; locator: Locator }[]
}

// New console surfaces have no legacy page for screenshot comparison.
export const newPages = {
  'console-mcp-servers-page': { route: '/console/mcp/servers', legacyRoute: null },
} as const
