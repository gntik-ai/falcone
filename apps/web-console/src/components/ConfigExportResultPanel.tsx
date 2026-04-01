import type { ExportArtifact } from '@/api/configExportApi'

interface ConfigExportResultPanelProps {
  artifact: ExportArtifact | null
  isLoading: boolean
  error?: string
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  empty: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-800',
  not_available: 'bg-slate-50 text-slate-400',
  not_requested: 'bg-slate-50 text-slate-400',
}

function downloadJson(artifact: ExportArtifact) {
  const ts = artifact.export_timestamp.replace(/[:.]/g, '-')
  const filename = `config-export-${artifact.tenant_id}-${ts}.json`
  const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ConfigExportResultPanel({ artifact, isLoading, error }: ConfigExportResultPanelProps) {
  if (isLoading) {
    return (
      <div data-testid="result-loading" className="animate-pulse p-6 text-center text-slate-500">
        Exportando configuración…
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="result-error" className="rounded-md bg-red-50 p-4 text-red-700">
        {error}
      </div>
    )
  }

  if (!artifact) return null

  return (
    <div data-testid="result-panel" className="space-y-4">
      <div className="rounded-md border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Metadata de exportación</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-slate-500">Tenant</dt>
          <dd>{artifact.tenant_id}</dd>
          <dt className="text-slate-500">Formato</dt>
          <dd>{artifact.format_version}</dd>
          <dt className="text-slate-500">Timestamp</dt>
          <dd>{artifact.export_timestamp}</dd>
          <dt className="text-slate-500">Perfil</dt>
          <dd>{artifact.deployment_profile}</dd>
          <dt className="text-slate-500">Correlation ID</dt>
          <dd className="font-mono text-[10px]">{artifact.correlation_id}</dd>
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Dominios</h3>
        <ul className="space-y-1">
          {artifact.domains.map(d => (
            <li key={d.domain_key} className="flex items-center gap-2 text-sm" data-testid={`domain-result-${d.domain_key}`}>
              <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[d.status] ?? ''}`}>
                {d.status}
              </span>
              <span className="text-slate-700">{d.domain_key}</span>
              {d.items_count !== undefined && d.status === 'ok' && (
                <span className="text-xs text-slate-400">({d.items_count} items)</span>
              )}
              {d.status === 'error' && d.error && (
                <span className="text-xs text-red-600" data-testid={`domain-error-${d.domain_key}`}>
                  — {d.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => downloadJson(artifact)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        data-testid="download-json-btn"
      >
        Descargar JSON
      </button>
    </div>
  )
}
