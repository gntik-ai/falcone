import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/console/profile',
  roles: ['tenant_owner'],
  fixtures: ['tenant', 'tenants', 'workspaces', 'refresh', 'status', 'termination'],
  endpoints: {},
  sources: ['src/pages/consoleProfile.tsx'],
  data: [
    { name: 'profile heading', locator: { es: 'h1:text-is("Perfil de usuario")', en: 'h1:text-is("User profile")' } },
    { name: 'principal', locator: '.console-profile h2:text-is("Synthetic Operator")' },
    { name: 'organization', locator: '.console-profile dd:text-is("Synthetic Tenant")' },
    { name: 'workspace', locator: '.console-profile dd:text-is("Synthetic Workspace")' },
    { name: 'admin role', locator: '.console-profile :text-is("tenant_admin")' },
    { name: 'auditor role', locator: '.console-profile :text-is("platform_auditor")' },
  ],
  actions: [],
  states: [
    { fixture: 'workspaces', variant: '403', locator: { es: '.console-profile h2:text-is("Sin acceso al contexto activo")', en: '.console-profile h2:text-is("No access to the active context")' } },
    { fixture: 'workspaces', variant: '404', locator: { es: '.console-profile h2:text-is("Contexto activo no encontrado")', en: '.console-profile h2:text-is("Active context not found")' } },
    { fixture: 'workspaces', variant: '500', locator: { es: '.console-profile h2:text-is("No se pudo cargar el contexto activo")', en: '.console-profile h2:text-is("Could not load the active context")' } },
    { fixture: 'workspaces', variant: 'network', locator: { es: '.console-profile h2:text-is("No se pudo cargar el contexto activo")', en: '.console-profile h2:text-is("Could not load the active context")' } },
  ],
}
export default manifest
