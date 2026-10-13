import { BrowserRouter, Outlet, useRoutes, type RouteObject } from 'react-router-dom'

function Placeholder({ title }: { title: string }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Esta página estará disponible próximamente.</p>
    </section>
  )
}

const consolePages = [
  ['overview', 'Resumen'],
  ['tenants', 'Organizaciones'],
  ['workspaces', 'Áreas de trabajo'],
  ['database', 'Bases de datos'],
  ['functions-registry', 'Registro de funciones'],
  ['iam-access', 'Acceso y permisos'],
  ['members', 'Miembros'],
  ['plans', 'Planes'],
  ['plans/new', 'Crear plan'],
  ['plans/:planId', 'Detalle del plan'],
  ['tenants/:tenantId/plan', 'Plan de la organización'],
  ['my-plan', 'Mi plan'],
  ['my-plan/allocation', 'Asignación de mi plan'],
  ['workspaces/:workspaceId', 'Área de trabajo'],
  ['auth', 'Autenticación'],
  ['auth-config', 'Configuración de autenticación'],
  ['postgres', 'PostgreSQL'],
  ['postgres/data', 'Datos de PostgreSQL'],
  ['mongo', 'Documentos'],
  ['mongo/data', 'Datos de documentos'],
  ['kafka', 'Kafka'],
  ['events/data', 'Datos de eventos'],
  ['functions', 'Funciones'],
  ['functions/data', 'Datos de funciones'],
  ['realtime/changes', 'Cambios en tiempo real'],
  ['flows', 'Flujos'],
  ['flows/:flowId', 'Diseñador de flujo'],
  ['flows/:flowId/runs', 'Historial del flujo'],
  ['flows/:flowId/runs/:executionId', 'Ejecución del flujo'],
  ['storage', 'Almacenamiento'],
  ['observability', 'Observabilidad'],
  ['runtime', 'Entorno de ejecución'],
  ['service-accounts', 'Cuentas de servicio'],
  ['quotas', 'Cuotas'],
  ['operations', 'Operaciones'],
  ['operations/:operationId', 'Detalle de la operación'],
  ['mcp/servers/:mcpServerId', 'Servidor MCP'],
  ['workspaces/:workspaceId/realtime', 'Tiempo real'],
  ['workspaces/:workspaceId/docs', 'Documentación'],
  ['secrets', 'Secretos'],
  ['secrets/:encodedSecretPath/rotate', 'Rotación de secretos'],
  ['workspace-secrets', 'Secretos del área de trabajo'],
  ['profile', 'Perfil'],
  ['settings', 'Configuración'],
  ['*', 'Página no encontrada']
] as const

export const appRoutes: RouteObject[] = [
  { path: '/', element: <Placeholder title="Bienvenida" /> },
  { path: '/login', element: <Placeholder title="Acceso" /> },
  { path: '/password-recovery', element: <Placeholder title="Recuperar contraseña" /> },
  { path: '/invitations/:tenantId/:invitationId', element: <Placeholder title="Aceptar invitación" /> },
  { path: '/signup', element: <Placeholder title="Solicitar acceso" /> },
  { path: '/signup/pending-activation', element: <Placeholder title="Registro pendiente" /> },
  { path: '*', element: <Placeholder title="Página no encontrada" /> },
  {
    path: '/console',
    element: <Outlet />,
    children: [
      { index: true, element: <Placeholder title="Consola" /> },
      ...consolePages.map(([path, title]) => ({ path, element: <Placeholder title={title} /> }))
    ]
  }
]

function RouteContent() {
  return useRoutes(appRoutes)
}

export function AppRouter({ basename = import.meta.env.BASE_URL }: { basename?: string }) {
  return <BrowserRouter basename={basename}><RouteContent /></BrowserRouter>
}
