import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { ConsoleShellLayout } from '@/layouts/ConsoleShellLayout'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
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
import { SignupPage } from '@/pages/SignupPage'
import { readConsoleShellSession } from '@/lib/console-session'
import { WelcomePage } from '@/pages/WelcomePage'

const ConsoleRealtimePage = lazy(async () => {
  const module = await import('@/pages/ConsoleRealtimePage')
  return { default: module.ConsoleRealtimePage }
})

const ConsoleDocsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleDocsPage')
  return { default: module.ConsoleDocsPage }
})

const ConsoleSecretsPage = lazy(async () => {
  const module = await import('@/pages/ConsoleSecretsPage')
  return { default: module.ConsoleSecretsPage }
})

const ConsoleSecretRotationPage = lazy(async () => {
  const module = await import('@/pages/ConsoleSecretRotationPage')
  return { default: module.ConsoleSecretRotationPage }
})


function RequireSuperadminRoute({ children }: { children: JSX.Element }) {
  const session = readConsoleShellSession()
  const roles = session?.principal?.platformRoles ?? []
  return roles.includes('superadmin') ? children : <Navigate replace to="/console/my-plan" />
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
            element: <ConsoleAuthPage />
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
            path: 'workspaces/:workspaceId/realtime',
            element: <ConsoleRealtimePage />
          },
          {
            path: 'workspaces/:workspaceId/docs',
            element: <ConsoleDocsPage />
          },
          {
            path: 'secrets',
            element: <ConsoleSecretsPage />
          },
          {
            path: 'secrets/:encodedSecretPath/rotate',
            element: <ConsoleSecretRotationPage />
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
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router
