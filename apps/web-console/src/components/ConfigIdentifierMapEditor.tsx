import { useState, useCallback } from 'react'
import type { IdentifierMapEntry } from '@/api/configReprovisionApi'

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
      <div data-testid="identifier-map-empty" className="rounded-md border border-slate-200 p-4 text-sm text-slate-500">
        No hay reemplazos de identificadores necesarios (el tenant de origen coincide con el destino).
      </div>
    )
  }

  return (
    <div data-testid="identifier-map-editor" className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">Mapa de identificadores</h3>
      <p className="text-xs text-slate-500">
        Revisa y ajusta los valores de destino antes de ejecutar el reaprovisionamiento.
      </p>
      <table className="w-full text-sm border-collapse" role="table">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase" scope="col">Scope</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase" scope="col">Desde (origen)</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase" scope="col">Hacia (destino)</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const isInvalid = !entry.to || entry.to.trim().length === 0
            return (
              <tr
                key={`${entry.from}-${index}`}
                className={`border-b border-slate-100 ${isInvalid ? 'bg-red-50' : ''}`}
                data-testid={`identifier-map-row-${index}`}
              >
                <td className="py-2 px-3">
                  {entry.scope ? (
                    <span className="inline-block rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {entry.scope}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td className="py-2 px-3">
                  <span className="font-mono text-xs text-slate-700" data-testid={`identifier-map-from-${index}`}>
                    {entry.from}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="text"
                    value={entry.to}
                    onChange={(e) => handleToChange(index, e.target.value)}
                    disabled={disabled}
                    className={`w-full rounded border px-2 py-1 text-xs font-mono ${
                      isInvalid
                        ? 'border-red-400 bg-red-50 text-red-800 focus:ring-red-500'
                        : 'border-slate-300 text-slate-700 focus:ring-blue-500'
                    } focus:outline-none focus:ring-1`}
                    aria-label={`Valor destino para ${entry.from}`}
                    data-testid={`identifier-map-to-${index}`}
                  />
                  {isInvalid && (
                    <span className="block mt-0.5 text-[10px] text-red-600">El valor destino es obligatorio</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
