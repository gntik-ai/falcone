import { useState, useCallback } from 'react'
import type { IdentifierMapEntry } from '@/api/configReprovisionApi'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface ConfigIdentifierMapEditorProps {
  entries: IdentifierMapEntry[]
  onChange: (entries: IdentifierMapEntry[]) => void
  disabled?: boolean
}

export function ConfigIdentifierMapEditor({ entries, onChange, disabled = false }: ConfigIdentifierMapEditorProps) {
  const handleToChange = useCallback((index: number, newTo: string) => {
    const updated = entries.map((entry, i) =>
      i === index ? { ...entry, to: newTo } : entry
    )
    onChange(updated)
  }, [entries, onChange])

  if (!entries || entries.length === 0) {
    return (
      <div data-testid="identifier-map-empty" className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        No hay reemplazos de identificadores necesarios (la organización de origen coincide con el destino).
      </div>
    )
  }

  return (
    <div data-testid="identifier-map-editor" className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Mapa de identificadores</h3>
      <p className="text-xs text-muted-foreground">
        Revisa y ajusta los valores de destino antes de ejecutar el reaprovisionamiento.
      </p>
      <Table role="table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Alcance</TableHead>
            <TableHead scope="col">Desde (origen)</TableHead>
            <TableHead scope="col">Hacia (destino)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => {
            const isInvalid = !entry.to || entry.to.trim().length === 0
            return (
              <TableRow
                key={`${entry.from}-${index}`}
                className={isInvalid ? 'bg-destructive/5' : undefined}
                data-testid={`identifier-map-row-${index}`}
              >
                <TableCell>
                  {entry.scope ? (
                    <span className="inline-block rounded border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {entry.scope}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-foreground" data-testid={`identifier-map-from-${index}`}>
                    {entry.from}
                  </span>
                </TableCell>
                <TableCell>
                  <input
                    type="text"
                    value={entry.to}
                    onChange={(e) => handleToChange(index, e.target.value)}
                    disabled={disabled}
                    className={`w-full rounded border bg-background px-2 py-1 text-xs font-mono ${
                      isInvalid
                        ? 'border-destructive text-destructive focus:ring-destructive'
                        : 'border-input text-foreground focus:ring-ring'
                    } focus:outline-none focus:ring-1`}
                    aria-label={`Valor destino para ${entry.from}`}
                    data-testid={`identifier-map-to-${index}`}
                  />
                  {isInvalid && (
                    <span className="block mt-0.5 text-[10px] text-destructive">El valor destino es obligatorio</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
