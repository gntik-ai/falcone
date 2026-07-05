import type { ReprovisionResult, DomainResult, ResourceResult } from '@/api/configReprovisionApi'
import { useState } from 'react'

interface ConfigReprovisionResultPanelProps {
  result: ReprovisionResult | null
  loading: boolean
  error?: string
}

const STATUS_COLORS: Record<string, string> = {
  applied: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  applied_with_warnings: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  would_apply: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300',
  would_apply_with_warnings: 'border-amber-500/20 bg-amber-500/5 text-amber-300',
  skipped: 'border-border bg-muted/40 text-muted-foreground',
  would_skip: 'border-border bg-muted/20 text-muted-foreground',
  skipped_not_exportable: 'border-border bg-muted/20 text-muted-foreground',
  skipped_no_applier: 'border-border bg-muted/20 text-muted-foreground',
  conflict: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  would_conflict: 'border-orange-500/20 bg-orange-500/5 text-orange-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
}

const RESULT_STATUS_COLORS: Record<string, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  dry_run: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
}

const ACTION_COLORS: Record<string, string> = {
  created: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  applied_with_warnings: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  would_create: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300',
  skipped: 'border-border bg-muted/40 text-muted-foreground',
  would_skip: 'border-border bg-muted/20 text-muted-foreground',
  conflict: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  would_conflict: 'border-orange-500/20 bg-orange-500/5 text-orange-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
}

function DomainSection({ domain }: { domain: DomainResult }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border rounded-md" data-testid={`domain-result-${domain.domain_key}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-left hover:bg-accent/40"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[domain.status] ?? ''}`}>
            {domain.status}
          </span>
          <span className="text-sm font-medium text-foreground">{domain.domain_key}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {domain.counts.created > 0 && <span className="text-emerald-300">{domain.counts.created} creados</span>}
          {domain.counts.skipped > 0 && <span>{domain.counts.skipped} omitidos</span>}
          {domain.counts.conflicts > 0 && <span className="text-orange-300">{domain.counts.conflicts} conflictos</span>}
          {domain.counts.errors > 0 && <span className="text-red-300">{domain.counts.errors} errores</span>}
          <span className="text-muted-foreground">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && domain.resource_results.length > 0 && (
        <div className="border-t border-border p-3 space-y-1">
          {domain.resource_results.map((r: ResourceResult, i: number) => (
            <div key={`${r.resource_name}-${i}`} className="flex items-start gap-2 text-xs py-1" data-testid={`resource-result-${domain.domain_key}-${i}`}>
              <span className={`inline-block rounded border px-1.5 py-0.5 font-medium whitespace-nowrap ${ACTION_COLORS[r.action] ?? ''}`}>
                {r.action}
              </span>
              <div className="flex-1">
                <span className="font-mono text-foreground">{r.resource_type}/{r.resource_name}</span>
                {r.message && <p className="text-muted-foreground mt-0.5">{r.message}</p>}
                {r.warnings.length > 0 && (
                  <ul className="mt-0.5 text-amber-300">
                    {r.warnings.map((w, wi) => <li key={wi}>⚠ {w}</li>)}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && domain.resource_results.length === 0 && domain.message && (
        <div className="border-t border-border p-3 text-xs text-muted-foreground">{domain.message}</div>
      )}
    </div>
  )
}

export function ConfigReprovisionResultPanel({ result, loading, error }: ConfigReprovisionResultPanelProps) {
  if (loading) {
    return (
      <div data-testid="result-loading" className="animate-pulse p-6 text-center text-muted-foreground">
        Procesando reaprovisionamiento…
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

  if (!result) return null

  return (
    <div data-testid="result-panel" className="space-y-4">
      {result.dry_run && (
        <div data-testid="dry-run-banner" className="rounded-md border-2 border-sky-500/30 bg-sky-500/10 p-3 text-sm font-medium text-sky-300">
          🔬 SIMULACIÓN — Ningún cambio ha sido aplicado
        </div>
      )}

      <div className="rounded-md border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground">Resultado del reaprovisionamiento</h3>
          <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${RESULT_STATUS_COLORS[result.result_status] ?? ''}`}>
            {result.result_status}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
          <dt className="text-muted-foreground">Organización destino</dt>
          <dd className="text-foreground">{result.tenant_id}</dd>
          <dt className="text-muted-foreground">Organización origen</dt>
          <dd className="text-foreground">{result.source_tenant_id}</dd>
          <dt className="text-muted-foreground">Formato</dt>
          <dd className="text-foreground">{result.format_version}</dd>
          <dt className="text-muted-foreground">ID de correlación</dt>
          <dd className="font-mono text-[10px] text-foreground">{result.correlation_id}</dd>
        </dl>

        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="rounded bg-emerald-500/10 p-2">
            <div className="text-lg font-bold text-emerald-300">{result.summary.resources_created}</div>
            <div className="text-muted-foreground">Creados</div>
          </div>
          <div className="rounded bg-muted/40 p-2">
            <div className="text-lg font-bold text-muted-foreground">{result.summary.resources_skipped}</div>
            <div className="text-muted-foreground">Omitidos</div>
          </div>
          <div className="rounded bg-orange-500/10 p-2">
            <div className="text-lg font-bold text-orange-300">{result.summary.resources_conflicted}</div>
            <div className="text-muted-foreground">Conflictos</div>
          </div>
          <div className="rounded bg-red-500/10 p-2">
            <div className="text-lg font-bold text-red-300">{result.summary.resources_failed}</div>
            <div className="text-muted-foreground">Fallidos</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Dominios ({result.domain_results.length})</h3>
        {result.domain_results.map(d => (
          <DomainSection key={d.domain_key} domain={d} />
        ))}
      </div>
    </div>
  )
}
