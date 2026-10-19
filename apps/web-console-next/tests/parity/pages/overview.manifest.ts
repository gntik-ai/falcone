import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/console/overview',
  roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', 'status', 'termination'],
  sources: ['src/pages/overview.tsx', 'src/pages/placeholder.tsx', 'src/shell', 'src/App.tsx', 'src/styles.css'],
  data: [
    { name: 'overview title', locator: { es: 'h1:text-is("Resumen")', en: 'h1:text-is("Overview")' } },
    { name: 'placeholder description', locator: { es: 'main p:text-is("Esta página estará disponible próximamente.")', en: 'main p:text-is("This page will be available soon.")' } },
    { name: 'tenant', locator: 'select:has(option:checked:text-is("Synthetic Tenant"))' },
    { name: 'workspace', locator: { es: 'button:has-text("Synthetic Workspace")', en: 'button:has-text("Synthetic Workspace")' } },
  ],
  actions: [{
    name: 'sign out',
    trigger: [
      { es: 'button[aria-label="Menú de usuario"]', en: 'button[aria-label="User menu"]' },
      { es: '[role="menuitem"]:has-text("Cerrar sesión")', en: '[role="menuitem"]:has-text("Sign out")' },
    ],
    expected: { method: 'DELETE', path: '/v1/auth/login-sessions/synthetic-session', body: { refreshToken: 'synthetic-refresh-token' } },
    outcome: { es: 'h1:text-is("Acceso")', en: 'h1:text-is("Sign in")' },
  }],
  // The placeholder has no data-state panel. These are the shell's actual context states.
  states: [
    { fixture: 'workspaces', variant: 'empty', locator: { es: 'button[aria-label="Área de trabajo activa"]:has-text("Select workspace")', en: 'button[aria-label="Active workspace"]:has-text("Select workspace")' } },
    ...(['401', '403', '404', '500', 'network'] as const).map((variant) => ({
      fixture: 'workspaces', variant,
      locator: { es: '[role="status"]:text-is("Comprueba tu conexión e inténtalo de nuevo.")', en: '[role="status"]:text-is("Check your connection and try again.")' },
    })),
  ],
}
export default manifest
