import { Outlet, type RouteObject, useRoutes } from 'react-router-dom'

export function routerBasename(base = import.meta.env.VITE_BASE_PATH || '/'): string {
  return base.replace(/\/+$/, '') || '/'
}

export function ConsoleRoutes() {
  return useRoutes(appRoutes)
}

function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Esta página estará disponible próximamente.</p>
    </section>
  )
}

export const appRoutes: RouteObject[] = [
  {
    element: <Outlet />,
    children: [
      { path: '/', element: <Placeholder title="Bienvenida" /> },
      { path: '/login', element: <Placeholder title="Acceso" /> },
      { path: '/password-recovery', element: <Placeholder title="Recuperar contraseña" /> },
      { path: '/invitations/:tenantId/:invitationId', element: <Placeholder title="Aceptar invitación" /> },
      { path: '/signup', element: <Placeholder title="Solicitar acceso" /> },
      { path: '/signup/pending-activation', element: <Placeholder title="Registro pendiente" /> },
      { path: '*', element: <Placeholder title="Página no encontrada" /> }
    ]
  },
  {
    path: '/console',
    element: <Outlet />,
    children: [
      { index: true, element: <Placeholder title="Consola" /> },
      { path: 'overview', element: <Placeholder title="Resumen" /> },
      ...[
        'tenants',
        'workspaces',
        'database',
        'functions-registry',
        'iam-access',
        'members',
        'plans',
        'plans/new',
        'plans/:planId',
        'tenants/:tenantId/plan',
        'my-plan',
        'my-plan/allocation',
        'workspaces/:workspaceId',
        'auth',
        'auth-config',
        'postgres',
        'postgres/data',
        'mongo',
        'mongo/data',
        'kafka',
        'events/data',
        'functions',
        'functions/data',
        'realtime/changes',
        'flows',
        'flows/:flowId',
        'flows/:flowId/runs',
        'flows/:flowId/runs/:executionId',
        'storage',
        'observability',
        'runtime',
        'service-accounts',
        'quotas',
        'operations',
        'operations/:operationId',
        'mcp/servers/:mcpServerId',
        'workspaces/:workspaceId/realtime',
        'workspaces/:workspaceId/docs',
        'secrets',
        'secrets/:encodedSecretPath/rotate',
        'workspace-secrets',
        'profile',
        'settings'
      ].map((path) => ({ path, element: <Placeholder title="Página pendiente" /> })),
      { path: '*', element: <Placeholder title="Página no encontrada" /> }
    ]
  }
]
