import { Button } from '@/components/ui/button'
import type { ExportArtifact } from '@/api/configExportApi'

interface ConfigExportResultPanelProps {
  artifact: ExportArtifact | null
  isLoading: boolean
  error?: string
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  empty: 'border-border bg-muted/40 text-muted-foreground',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  not_available: 'border-border bg-muted/40 text-muted-foreground',
  not_requested: 'border-border bg-muted/40 text-muted-foreground',
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
      <div data-testid="result-loading" className="animate-pulse p-6 text-center text-muted-foreground">
        Exportando configuración…
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="result-error" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive">
        {error}
      </div>
    )
  }

  if (!artifact) return null

  return (
    <div data-testid="result-panel" className="space-y-4">
      <div className="rounded-md border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">Metadatos de exportación</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Organización</dt>
          <dd className="text-foreground">{artifact.tenant_id}</dd>
          <dt className="text-muted-foreground">Formato</dt>
          <dd className="text-foreground">{artifact.format_version}</dd>
          <dt className="text-muted-foreground">Timestamp</dt>
          <dd className="text-foreground">{artifact.export_timestamp}</dd>
          <dt className="text-muted-foreground">Perfil</dt>
          <dd className="text-foreground">{artifact.deployment_profile}</dd>
          <dt className="text-muted-foreground">ID de correlación</dt>
          <dd className="font-mono text-[10px] text-foreground">{artifact.correlation_id}</dd>
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Dominios</h3>
        <ul className="space-y-1">
          {artifact.domains.map(d => (
            <li key={d.domain_key} className="flex items-center gap-2 text-sm" data-testid={`domain-result-${d.domain_key}`}>
              <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[d.status] ?? ''}`}>
                {d.status}
              </span>
              <span className="text-foreground">{d.domain_key}</span>
              {d.items_count !== undefined && d.status === 'ok' && (
                <span className="text-xs text-muted-foreground">({d.items_count} items)</span>
              )}
              {d.status === 'error' && d.error && (
                <span className="text-xs text-destructive" data-testid={`domain-error-${d.domain_key}`}>
                  — {d.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Button type="button" onClick={() => downloadJson(artifact)} data-testid="download-json-btn">
        Descargar JSON
      </Button>
    </div>
  )
}
