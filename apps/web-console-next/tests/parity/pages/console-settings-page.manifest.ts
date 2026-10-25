import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/console/settings',
  roles: ['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_admin', 'workspace_viewer'],
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', 'status', 'termination'],
  endpoints: {},
  sources: ['src/pages/settings.tsx', 'src/i18n/locale-loader.ts', 'src/i18n/LocaleSwitch.tsx', 'src/shell/RouteState.tsx', 'src/shell/breadcrumbs.ts'],
  data: [
    { name: 'settings title', locator: { es: 'h1:text-is("Ajustes de consola")', en: 'h1:text-is("Console settings")' } },
    { name: 'tenant label', locator: { es: 'p:has-text("Preferencias operativas para tu cuenta y para Synthetic Tenant.")', en: 'p:has-text("Operational preferences for your account and for Synthetic Tenant.")' } },
    { name: 'no preferences', locator: { es: 'h2:text-is("Sin preferencias configurables")', en: 'h2:text-is("No configurable preferences")' } },
  ],
  // These local actions send no API request; the spec asserts that explicitly.
  actions: [],
  states: [
    { fixture: 'workspaces', variant: '403', locator: { es: '[role="status"]:text-is("No tienes permiso para ver esta página.")', en: '[role="status"]:text-is("You do not have permission to view this page.")' } },
  ],
}
export default manifest
