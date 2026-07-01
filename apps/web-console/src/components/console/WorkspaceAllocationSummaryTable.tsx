export function WorkspaceAllocationSummaryTable({ rows }: { rows: Array<{ dimensionKey: string; displayLabel: string; unit?: string | null; tenantEffectiveValue: number; totalAllocated: number; unallocated: number | null; workspaces: Array<{ workspaceId: string; allocatedValue: number }>; isFullyAllocated: boolean }> }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <p className="mb-2 font-semibold">Resumen de asignación de áreas de trabajo</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm" aria-label="Resumen de asignación de áreas de trabajo">
          <caption className="sr-only">Resumen de asignación de áreas de trabajo</caption>
          <thead>
            <tr className="text-left">
              <th className="px-3 py-2">Dimensión</th>
              <th className="px-3 py-2">Límite de la organización</th>
              <th className="px-3 py-2">Asignado</th>
              <th className="px-3 py-2">Sin asignar</th>
              <th className="px-3 py-2">Desglose</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.dimensionKey} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">{row.displayLabel}</td>
                <td className="px-3 py-2">{row.tenantEffectiveValue === -1 ? 'Sin límite' : row.tenantEffectiveValue}</td>
                <td className="px-3 py-2">{row.totalAllocated}</td>
                <td className="px-3 py-2">{row.unallocated ?? '—'}{row.isFullyAllocated ? ' (asignado por completo)' : ''}</td>
                <td className="px-3 py-2">{row.workspaces.length > 0 ? row.workspaces.map((item) => `${item.workspaceId}: ${item.allocatedValue}`).join(', ') : 'Reserva compartida'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
