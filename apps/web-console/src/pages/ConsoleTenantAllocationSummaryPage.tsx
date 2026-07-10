import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Boxes, Inbox, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceAllocationSummaryTable } from '@/components/console/WorkspaceAllocationSummaryTable'
import { describeConsoleError } from '@/lib/console-errors'
import { isTenantlessPlatformPrincipal } from '@/lib/console-principal'
import { readConsoleShellSession } from '@/lib/console-session'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantAllocationSummaryPage() {
  const tenantlessPlatformPrincipal = isTenantlessPlatformPrincipal(readConsoleShellSession()?.principal)
  const [data, setData] = useState<api.AllocationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    if (tenantlessPlatformPrincipal) {
      setData(null)
      setError(null)
      return
    }

    setError(null)
    api.getTenantAllocationSummary().then(setData).catch((err) => setError(describeConsoleError(err, 'No se pudo cargar el resumen de asignación')))
  }, [tenantlessPlatformPrincipal, reloadNonce])

  let content

  if (tenantlessPlatformPrincipal) {
    content = (
      <ConsolePageState
        kind="empty"
        title="Sin plan de organización personal"
        description="Esta cuenta de plataforma no está asociada a una organización, así que no hay asignaciones personales de organización para mostrar."
        icon={<Boxes className="h-5 w-5" data-testid="allocation-empty-state-icon" />}
      />
    )
  } else if (error) {
    content = (
      <ConsolePageState
        kind="error"
        title="Resumen de asignación no disponible"
        description={error}
        actionLabel="Reintentar"
        onAction={() => setReloadNonce((nonce) => nonce + 1)}
        icon={<AlertCircle className="h-5 w-5" data-testid="allocation-error-state-icon" />}
      />
    )
  } else if (!data) {
    content = (
      <ConsolePageState
        kind="loading"
        title="Cargando resumen de asignación"
        description="Obteniendo subcuotas asignadas a áreas de trabajo."
        icon={<Loader2 className="h-5 w-5 animate-spin" data-testid="allocation-loading-state-icon" />}
      />
    )
  } else if (data.dimensions.every((item) => item.workspaces.length === 0)) {
    content = (
      <ConsolePageState
        kind="empty"
        title="Todavía no hay asignaciones de área de trabajo"
        description="Todas las dimensiones usan actualmente la reserva compartida de la organización."
        icon={<Inbox className="h-5 w-5" data-testid="allocation-empty-state-icon" />}
      />
    )
  } else {
    content = <WorkspaceAllocationSummaryTable rows={data.dimensions} />
  }

  return (
    <section className="space-y-6">
      <AllocationSummaryHeader />
      {content}
    </section>
  )
}

function AllocationSummaryHeader() {
  return (
    <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
      <nav aria-label="Ruta de navegación del plan" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/console/my-plan"
          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Mi plan
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">Resumen de asignación</span>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Resumen de asignación</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Subcuotas por área de trabajo para tu organización.
      </p>
    </header>
  )
}
