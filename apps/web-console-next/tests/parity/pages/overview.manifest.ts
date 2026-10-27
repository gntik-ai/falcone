import type { ParityManifest } from '../manifest'

const manifest: ParityManifest = {
  route: '/console/overview',
  roles: ['superadmin', 'tenant_owner', 'tenant_viewer'],
  fixtures: ['tenants', 'tenant', 'workspaces', 'refresh', 'status', 'termination'],
  sources: ['src/pages/overview.tsx', 'src/pages/overview/summary.ts', 'src/shell', 'src/App.tsx', 'src/styles.css'],
  data: [
    { name: 'overview title', locator: { es: 'h1:text-is("Vista general de la consola")', en: 'h1:text-is("Console overview")' } },
    { name: 'quick links', locator: { es: 'h2:text-is("Accesos rápidos")', en: 'h2:text-is("Quick links")' } },
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
    outcome: { es: 'h1:text-is("Accede a In Falcone Console")', en: 'h1:text-is("Sign in to In Falcone Console")' },
  }],
  states: [
    // Known kit localisation gap: assert no selected workspace without requiring English in es.
    { fixture: 'workspaces', variant: 'empty', locator: { es: 'button[aria-label="Área de trabajo activa"]:not(:has-text("Synthetic Workspace"))', en: 'button[aria-label="Active workspace"]:has-text("Select workspace")' } },
    ...(['401', '403', '404', '500', 'network'] as const).map((variant) => ({
      fixture: 'workspaces', variant,
      locator: variant === '401'
        ? { es: 'h1:text-is("Accede a In Falcone Console")', en: 'h1:text-is("Sign in to In Falcone Console")' }
        : variant === '403'
        ? { es: '[role="status"]:text-is("No tienes permiso para ver esta página.")', en: '[role="status"]:text-is("You do not have permission to view this page.")' }
        : { es: '[role="status"]:text-is("Comprueba tu conexión e inténtalo de nuevo.")', en: '[role="status"]:text-is("Check your connection and try again.")' },
    })),
  ],
}
export default manifest
