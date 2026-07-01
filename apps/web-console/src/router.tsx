import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { ConsoleShellLayout } from '@/layouts/ConsoleShellLayout'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PasswordRecoveryPage } from '@/pages/PasswordRecoveryPage'
import { PendingActivationPage } from '@/pages/PendingActivationPage'
import { ConsoleAuthPage } from '@/pages/ConsoleAuthPage'
import { ConsoleMembersPage } from '@/pages/ConsoleMembersPage'
import { ConsolePlaceholderPage } from '@/pages/ConsolePlaceholderPage'
import { ConsoleTenantsPage } from '@/pages/ConsoleTenantsPage'
import { ConsolePlanCatalogPage } from '@/pages/ConsolePlanCatalogPage'
import { ConsolePlanCreatePage } from '@/pages/ConsolePlanCreatePage'
import { ConsolePlanDetailPage } from '@/pages/ConsolePlanDetailPage'
import { ConsoleTenantPlanPage } from '@/pages/ConsoleTenantPlanPage'
import { ConsoleTenantPlanOverviewPage } from '@/pages/ConsoleTenantPlanOverviewPage'
import { ConsoleTenantAllocationSummaryPage } from '@/pages/ConsoleTenantAllocationSummaryPage'
import { ConsoleWorkspaceDashboardPage } from '@/pages/ConsoleWorkspaceDashboardPage'
import { ConsoleWorkspacesPage } from '@/pages/ConsoleWorkspacesPage'
import { ConsoleWorkspaceDatabasePage } from '@/pages/ConsoleWorkspaceDatabasePage'
import { ConsoleFunctionRegistryPage } from '@/pages/ConsoleFunctionRegistryPage'
import { ConsoleIamAccessPage } from '@/pages/ConsoleIamAccessPage'
// Eager (not lazy): clicking a NavLink to a lazy route suspends synchronously and
// throws React #426 in this build; import these wired pages directly.
import { ConsoleQuotasPage } from '@/pages/ConsoleQuotasPage'
import { ConsoleObservabilityPage } from '@/pages/ConsoleObservabilityPage'
import { ConsoleServiceAccountsPage } from '@/pages/ConsoleServiceAccountsPage'
import { ConsoleStoragePage } from '@/pages/ConsoleStoragePage'
import { ConsoleMongoPage } from '@/pages/ConsoleMongoPage'
import { ConsolePostgresPage } from '@/pages/ConsolePostgresPage'
import { ConsolePostgresDataPage } from '@/pages/ConsolePostgresDataPage'
import { ConsoleMongoDataPage } from '@/pages/ConsoleMongoDataPage'
import { ConsoleEventsDataPage } from '@/pages/ConsoleEventsDataPage'
import { ConsoleFunctionsDataPage } from '@/pages/ConsoleFunctionsDataPage'
import { ConsoleRealtimeChangesPage } from '@/pages/ConsoleRealtimeChangesPage'
import { ConsoleKafkaPage } from '@/pages/ConsoleKafkaPage'
import { ConsoleOperationsPage } from '@/pages/ConsoleOperationsPage'
import { ConsoleOperationDetailPage } from '@/pages/ConsoleOperationDetailPage'
import { ConsoleFunctionsPage } from '@/pages/ConsoleFunctionsPage'
import { ConsoleMcpServerDetailPage } from '@/pages/ConsoleMcpServerDetailPage'
import { ConsoleWorkspaceSecretsPage } from '@/pages/ConsoleWorkspaceSecretsPage'
// Eager (not lazy) for the same reason as the block above (#755): the secret-rotation table's
// "Rotate"/"History" buttons reach these routes via a synchronous in-app `navigate()`, so a lazy
// element would suspend synchronously and throw React #426 (blanking the whole shell).
import { ConsoleSecretsPage } from '@/pages/ConsoleSecretsPage'
import { ConsoleSecretRotationPage } from '@/pages/ConsoleSecretRotationPage'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import { SignupPage } from '@/pages/SignupPage'
import { consoleAuthConfig } from '@/lib/console-config'
import { readConsoleShellSession } from '@/lib/console-session'
import { canManageWorkspaceSecrets } from '@/lib/workspace-secrets-access'
import { useConsoleContext } from '@/lib/console-context'
import { WelcomePage } from '@/pages/WelcomePage'

const ConsoleRealtimePage = lazy(async () => {
  const module = await import('@/pages/ConsoleRealtimePage')
  return { default: module.ConsoleRealtimePage }
})

const ConsoleDocsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleDocsPage')
  return { default: module.ConsoleDocsPage }
})

// Flows section is code-split so the @xyflow/react canvas chunk stays out of the
// initial shell bundle (change: add-console-flow-designer).
const ConsoleFlowsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowsPage')
  return { default: module.ConsoleFlowsPage }
})

const ConsoleFlowDesignerPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowDesignerPage')
  return { default: module.ConsoleFlowDesignerPage }
})

// Flow run-view + run-history (change: add-console-flow-monitoring). Code-split with the rest of
// the flows section so the canvas chunk stays out of the initial shell bundle.
const ConsoleFlowRunPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowRunPage')
  return { default: module.ConsoleFlowRunPage }
})

const ConsoleFlowHistoryPage = lazy(async () => {
  const module = await import('@/pages/ConsoleFlowHistoryPage')
  return { default: module.ConsoleFlowHistoryPage }
})


function RequireSuperadminRoute({ children }: { children: JSX.Element }) {
  const session = readConsoleShellSession()
  const roles = session?.principal?.platformRoles ?? []
  return roles.includes('superadmin') ? children : <Navigate replace to="/console/my-plan" />
}

// Fail-safe, coarse gate for the Workspace Secrets screen (#723): an operator who is neither a
// member of the active workspace nor a tenant-admin/platform-role operator is redirected away. This
// runs inside ConsoleShellLayout's Outlet, so the ConsoleContext (active workspace) is available.
// Per-secret mutate authority stays server-enforced — this is defense-in-depth only.
function RequireWorkspaceSecretsRoute({ children }: { children: JSX.Element }) {
  const session = readConsoleShellSession()
  const { activeWorkspaceId } = useConsoleContext()
  return canManageWorkspaceSecrets(session, activeWorkspaceId) ? children : <Navigate replace to="/console/my-plan" />
}

// T05 endurece la entrada a `/console/*` con guardas de sesión y refresh on-demand.
export const appRoutes = [
  {
    path: '/',
    element: <WelcomePage />
  },
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: consoleAuthConfig.passwordRecoveryPath,
    element: <PasswordRecoveryPage />
  },
  {
    path: '/signup',
    element: <SignupPage />
  },
  {
    path: '/signup/pending-activation',
    element: <PendingActivationPage />
  },
  {
    path: '/console',
    element: <ProtectedRoute />,
    children: [
      {
        element: <ConsoleShellLayout />,
        children: [
          // Pathless layout route (#755): renders just an <Outlet/> so the content routes below stay
          // mounted inside ConsoleShellLayout's chrome, but carries a shell-level errorElement so a
          // render error in any content route is contained HERE (inside the shell's main <Outlet/>,
          // nav intact) instead of bubbling to react-router's root boundary and blanking the whole
          // console + leaking a raw minified stack.
          {
            errorElement: <RouteErrorBoundary />,
            children: [
          {
            index: true,
            element: <Navigate replace to="overview" />
          },
          {
            path: 'overview',
            element: (
              <ConsolePlaceholderPage
                badge="Overview"
                title="Vista general de la consola"
                description="Resumen inicial del producto y punto de entrada persistente para la navegación administrativa del BaaS multi-tenant."
              />
            )
          },
          {
            path: 'tenants',
            element: <ConsoleTenantsPage />
          },
          {
            path: 'workspaces',
            element: <ConsoleWorkspacesPage />
          },
          {
            path: 'database',
            element: <ConsoleWorkspaceDatabasePage />
          },
          {
            path: 'functions-registry',
            element: <ConsoleFunctionRegistryPage />
          },
          {
            path: 'iam-access',
            element: <RequireSuperadminRoute><ConsoleIamAccessPage /></RequireSuperadminRoute>
          },
          {
            path: 'members',
            element: <ConsoleMembersPage />
          },

          {
            path: 'plans',
            element: <RequireSuperadminRoute><ConsolePlanCatalogPage /></RequireSuperadminRoute>
          },
          {
            path: 'plans/new',
            element: <RequireSuperadminRoute><ConsolePlanCreatePage /></RequireSuperadminRoute>
          },
          {
            path: 'plans/:planId',
            element: <RequireSuperadminRoute><ConsolePlanDetailPage /></RequireSuperadminRoute>
          },
          {
            path: 'tenants/:tenantId/plan',
            element: <RequireSuperadminRoute><ConsoleTenantPlanPage /></RequireSuperadminRoute>
          },
          {
            path: 'my-plan',
            element: <ConsoleTenantPlanOverviewPage />
          },
          {
            path: 'my-plan/allocation',
            element: <ConsoleTenantAllocationSummaryPage />
          },
          {
            path: 'workspaces/:workspaceId',
            element: <ConsoleWorkspaceDashboardPage />
          },
          {
            path: 'auth',
            element: <RequireSuperadminRoute><ConsoleAuthPage /></RequireSuperadminRoute>
          },
          {
            path: 'postgres',
            element: <ConsolePostgresPage />
          },
          {
            path: 'postgres/data',
            element: <ConsolePostgresDataPage />
          },
          {
            path: 'mongo',
            element: <ConsoleMongoPage />
          },
          {
            path: 'mongo/data',
            element: <ConsoleMongoDataPage />
          },
          {
            path: 'kafka',
            element: <ConsoleKafkaPage />
          },
          {
            path: 'events/data',
            element: <ConsoleEventsDataPage />
          },
          {
            path: 'functions',
            element: <ConsoleFunctionsPage />
          },
          {
            path: 'functions/data',
            element: <ConsoleFunctionsDataPage />
          },
          {
            path: 'realtime/changes',
            element: <ConsoleRealtimeChangesPage />
          },
          {
            path: 'flows',
            element: <ConsoleFlowsPage />
          },
          {
            path: 'flows/:flowId',
            element: <ConsoleFlowDesignerPage />
          },
          {
            path: 'flows/:flowId/runs',
            element: <ConsoleFlowHistoryPage />
          },
          {
            path: 'flows/:flowId/runs/:executionId',
            element: <ConsoleFlowRunPage />
          },
          {
            path: 'storage',
            element: <ConsoleStoragePage />
          },
          {
            path: 'observability',
            element: <ConsoleObservabilityPage />
          },
          {
            path: 'service-accounts',
            element: <ConsoleServiceAccountsPage />
          },
          {
            path: 'quotas',
            element: <ConsoleQuotasPage />
          },
          {
            path: 'operations',
            element: <ConsoleOperationsPage />
          },
          {
            path: 'operations/:operationId',
            element: <ConsoleOperationDetailPage />
          },
          {
            path: 'mcp/servers/:mcpServerId',
            element: <ConsoleMcpServerDetailPage />
          },
          {
            path: 'workspaces/:workspaceId/realtime',
            element: <ConsoleRealtimePage />
          },
          {
            path: 'workspaces/:workspaceId/docs',
            element: <ConsoleDocsPage />
          },
          {
            // Legacy superadmin secret-ROTATION mock pages (platform/tenant rotation plane) — left
            // functionally untouched; relabeled in the nav to disambiguate from Workspace Secrets.
            path: 'secrets',
            element: <ConsoleSecretsPage />
          },
          {
            path: 'secrets/:encodedSecretPath/rotate',
            element: <ConsoleSecretRotationPage />
          },
          {
            // Workspace function secrets (#723) — distinct from the rotation route above. Gated by a
            // coarse, fail-safe workspace-membership / tenant-admin / platform guard.
            path: 'workspace-secrets',
            element: (
              <RequireWorkspaceSecretsRoute>
                <ConsoleWorkspaceSecretsPage />
              </RequireWorkspaceSecretsRoute>
            )
          },
          {
            path: 'profile',
            element: (
              <ConsolePlaceholderPage
                badge="Profile"
                title="Perfil de usuario"
                description="Entrada base para la futura gestión del perfil del operador autenticado dentro de la consola."
              />
            )
          },
          {
            path: 'settings',
            element: (
              <ConsolePlaceholderPage
                badge="Settings"
                title="Ajustes de consola"
                description="Entrada base para los ajustes operativos y preferencias de la experiencia administrativa."
              />
            )
          },
          {
            path: '*',
            element: <Navigate replace to="/console/overview" />
          }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router
