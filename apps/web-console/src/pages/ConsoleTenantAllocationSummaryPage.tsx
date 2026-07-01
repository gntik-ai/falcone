import { useEffect, useState } from 'react'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceAllocationSummaryTable } from '@/components/console/WorkspaceAllocationSummaryTable'
import { isTenantlessPlatformPrincipal } from '@/lib/console-principal'
import { readConsoleShellSession } from '@/lib/console-session'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantAllocationSummaryPage() {
  const tenantlessPlatformPrincipal = isTenantlessPlatformPrincipal(readConsoleShellSession()?.principal)
  const [data, setData] = useState<api.AllocationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tenantlessPlatformPrincipal) {
      setData(null)
      setError(null)
      return
    }

    api.getTenantAllocationSummary().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el resumen de asignación'))
  }, [tenantlessPlatformPrincipal])

  if (tenantlessPlatformPrincipal) {
    return (
      <ConsolePageState
        kind="empty"
        title="Sin plan de organización personal"
        description="Esta cuenta de plataforma no está asociada a una organización, así que no hay asignaciones personales de organización para mostrar."
      />
    )
  }
  if (error) return <ConsolePageState kind="error" title="Resumen de asignación no disponible" description={error} />
  if (!data) return <ConsolePageState kind="loading" title="Cargando resumen de asignación" description="Obteniendo subcuotas asignadas a áreas de trabajo." />
  if (data.dimensions.every((item) => item.workspaces.length === 0)) return <ConsolePageState kind="empty" title="Todavía no hay asignaciones de área de trabajo" description="Todas las dimensiones usan actualmente la reserva compartida de la organización." />

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Resumen de asignación</h1>
        <p>Organización: {data.tenantId}</p>
      </header>
      <WorkspaceAllocationSummaryTable rows={data.dimensions} />
    </main>
  )
}
