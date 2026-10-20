export type Role = 'superadmin' | 'tenant_owner' | 'tenant_viewer' | 'workspace_admin' | 'workspace_viewer'
export type Variant = 'success' | 'empty' | '401' | '403' | '404' | '500' | 'network'
export type EndpointScenario = Variant | { variant?: Variant; delayMs?: number; sequence?: Variant[] }
export type Locator = string | { es: string; en: string }
export interface ParityEndpoint {
  method: string
  path: string
  fixtures: { success: unknown; empty?: unknown }
}
export interface ParityManifest {
  route: string
  roles: Role[]
  fixtures: string[]
  sources: string[]
  endpoints?: Record<string, ParityEndpoint>
  data: { name: string; locator: Locator }[]
  actions: {
    name: string
    trigger: Locator[]
    expected: { method: string; path: string; body?: unknown }
    outcome: Locator
  }[]
  states: { fixture: string; variant: Exclude<Variant, 'success'>; locator: Locator }[]
}
