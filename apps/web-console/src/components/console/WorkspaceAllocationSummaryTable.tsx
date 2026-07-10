import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDimensionValue, isByteUnitDimension } from '@/lib/format'

type WorkspaceAllocation = {
  workspaceId: string
  allocatedValue: number
  displayLabel?: string | null
  workspaceDisplayName?: string | null
  workspaceName?: string | null
  workspaceSlug?: string | null
  name?: string | null
  slug?: string | null
}

type AllocationSummaryRow = {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  tenantEffectiveValue: number
  totalAllocated: number
  unallocated: number | null
  workspaces: WorkspaceAllocation[]
  isFullyAllocated: boolean
}

export function WorkspaceAllocationSummaryTable({ rows }: { rows: AllocationSummaryRow[] }) {
  return (
    <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-base font-semibold text-foreground">Resumen de asignación de áreas de trabajo</h2>
      <Table aria-label="Resumen de asignación de áreas de trabajo" containerClassName="border-border/70" className="w-full">
        <TableCaption>Resumen de asignación de áreas de trabajo</TableCaption>
        <TableHeader className="sr-only md:not-sr-only md:table-header-group">
          <TableRow>
            <TableHead scope="col">Dimensión</TableHead>
            <TableHead scope="col">Límite de la organización</TableHead>
            <TableHead scope="col">Asignado</TableHead>
            <TableHead scope="col">Sin asignar</TableHead>
            <TableHead scope="col">Desglose</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="block md:table-row-group">
          {rows.map((row) => (
            <TableRow key={row.dimensionKey} className="mb-3 block rounded-2xl border border-border/70 bg-background/50 p-3 align-top last:mb-0 md:mb-0 md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0">
              <th scope="row" className="block min-w-0 px-0 py-2 text-left md:table-cell md:px-4 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Dimensión</span>
                <span className="break-words font-medium text-foreground">{row.displayLabel}</span>
              </th>
              <TableCell className="block min-w-0 px-0 py-2 md:table-cell md:px-4 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Límite de la organización</span>
                <span className="font-mono tabular-nums text-foreground">{formatAllocationValue(row.tenantEffectiveValue, row)}</span>
              </TableCell>
              <TableCell className="block min-w-0 px-0 py-2 md:table-cell md:px-4 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Asignado</span>
                <span className="font-mono tabular-nums text-foreground">{formatAllocationValue(row.totalAllocated, row)}</span>
              </TableCell>
              <TableCell className="block min-w-0 px-0 py-2 md:table-cell md:px-4 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Sin asignar</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono tabular-nums text-foreground">{row.unallocated === null ? '—' : formatAllocationValue(row.unallocated, row)}</span>
                  {row.isFullyAllocated ? <Badge className="border-border bg-secondary text-secondary-foreground">Asignado por completo</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="block min-w-0 px-0 py-2 md:table-cell md:px-4 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Desglose</span>
                {row.workspaces.length > 0 ? (
                  <ul className="space-y-2">
                    {row.workspaces.map((item, index) => (
                      <li key={`${row.dimensionKey}-${item.workspaceId}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground">{formatWorkspaceLabel(item, index)}</span>
                        <span className="font-mono text-sm tabular-nums text-muted-foreground">
                          {formatAllocationValue(item.allocatedValue, row)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">Reserva compartida</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatAllocationValue(value: number, row: Pick<AllocationSummaryRow, 'dimensionKey' | 'unit'>) {
  if (value === -1) return 'Sin límite'
  const formatted = formatDimensionValue(value, row.unit, row.dimensionKey)
  const unit = row.unit?.trim()
  if (!unit || isByteUnitDimension(unit, row.dimensionKey)) return formatted
  return `${formatted} ${unit}`
}

function formatWorkspaceLabel(workspace: WorkspaceAllocation, index: number) {
  const explicitLabel = [
    workspace.displayLabel,
    workspace.workspaceDisplayName,
    workspace.workspaceName,
    workspace.workspaceSlug,
    workspace.name,
    workspace.slug
  ].find((value) => value && value.trim() && !isUuidLike(value.trim()))

  if (explicitLabel) return explicitLabel.trim()
  if (isUuidLike(workspace.workspaceId)) return `Área de trabajo ${index + 1}`
  return workspace.workspaceId
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
