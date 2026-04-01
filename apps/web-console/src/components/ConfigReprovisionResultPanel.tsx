import type { ReprovisionResult, DomainResult, ResourceResult } from '@/api/configReprovisionApi'
import { useState } from 'react'

interface ConfigReprovisionResultPanelProps {
  result: ReprovisionResult | null
  loading: boolean
  error?: string
}

const STATUS_COLORS: Record<string, string> = {
  applied: 'bg-emerald-100 text-emerald-800',
  applied_with_warnings: 'bg-amber-100 text-amber-800',
  would_apply: 'bg-emerald-50 text-emerald-700',
  would_apply_with_warnings: 'bg-amber-50 text-amber-700',
  skipped: 'bg-slate-100 text-slate-600',
  would_skip: 'bg-slate-50 text-slate-500',
  skipped_not_exportable: 'bg-slate-50 text-slate-400',
  skipped_no_applier: 'bg-slate-50 text-slate-400',
  conflict: 'bg-orange-100 text-orange-800',
  would_conflict: 'bg-orange-50 text-orange-700',
  error: 'bg-red-100 text-red-800',
}

const RESULT_STATUS_COLORS: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  dry_run: 'bg-blue-100 text-blue-800',
}

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-800',
  applied_with_warnings: 'bg-amber-100 text-amber-800',
  would_create: 'bg-emerald-50 text-emerald-700',
  skipped: 'bg-slate-100 text-slate-600',
  would_skip: 'bg-slate-50 text-slate-500',
  conflict: 'bg-orange-100 text-orange-800',
  would_conflict: 'bg-orange-50 text-orange-700',
  error: 'bg-red-100 text-red-800',
}

function DomainSection({ domain }: { domain: DomainResult }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-slate-200 rounded-md" data-testid={`domain-result-${domain.domain_key}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-50"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[domain.status] ?? ''}`}>
            {domain.status}
          </span>
          <span className="text-sm font-medium text-slate-700">{domain.domain_key}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {domain.counts.created > 0 && <span className="text-emerald-600">{domain.counts.created} creados</span>}
          {domain.counts.skipped > 0 && <span>{domain.counts.skipped} omitidos</span>}
          {domain.counts.conflicts > 0 && <span className="text-orange-600">{domain.counts.conflicts} conflictos</span>}
          {domain.counts.errors > 0 && <span className="text-red-600">{domain.counts.errors} errores</span>}
          <span className="text-slate-400">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && domain.resource_results.length > 0 && (
        <div className="border-t border-slate-100 p-3 space-y-1">
          {domain.resource_results.map((r: ResourceResult, i: number) => (
            <div key={`${r.resource_name}-${i}`} className="flex items-start gap-2 text-xs py-1" data-testid={`resource-result-${domain.domain_key}-${i}`}>
              <span className={`inline-block rounded px-1.5 py-0.5 font-medium whitespace-nowrap ${ACTION_COLORS[r.action] ?? ''}`}>
                {r.action}
              </span>
              <div className="flex-1">
                <span className="font-mono text-slate-700">{r.resource_type}/{r.resource_name}</span>
                {r.message && <p className="text-slate-500 mt-0.5">{r.message}</p>}
                {r.warnings.length > 0 && (
                  <ul className="mt-0.5 text-amber-600">
                    {r.warnings.map((w, wi) => <li key={wi}>⚠ {w}</li>)}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && domain.resource_results.length === 0 && domain.message && (
        <div className="border-t border-slate-100 p-3 text-xs text-slate-500">{domain.message}</div>
      )}
    </div>
  )
}

export function ConfigReprovisionResultPanel({ result, loading, error }: ConfigReprovisionResultPanelProps) {
  if (loading) {
    return (
      <div data-testid="result-loading" className="animate-pulse p-6 text-center text-slate-500">
        Procesando reaprovisionamiento…
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

  if (!result) return null

  return (
    <div data-testid="result-panel" className="space-y-4">
      {result.dry_run && (
        <div data-testid="dry-run-banner" className="rounded-md border-2 border-blue-300 bg-blue-50 p-3 text-sm font-medium text-blue-800">
          🔬 SIMULACIÓN — Ningún cambio ha sido aplicado
        </div>
      )}

      <div className="rounded-md border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Resultado del reaprovisionamiento</h3>
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${RESULT_STATUS_COLORS[result.result_status] ?? ''}`}>
            {result.result_status}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
          <dt className="text-slate-500">Tenant destino</dt>
          <dd>{result.tenant_id}</dd>
          <dt className="text-slate-500">Tenant origen</dt>
          <dd>{result.source_tenant_id}</dd>
          <dt className="text-slate-500">Formato</dt>
          <dd>{result.format_version}</dd>
          <dt className="text-slate-500">Correlation ID</dt>
          <dd className="font-mono text-[10px]">{result.correlation_id}</dd>
        </dl>

        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="rounded bg-emerald-50 p-2">
            <div className="text-lg font-bold text-emerald-700">{result.summary.resources_created}</div>
            <div className="text-slate-500">Creados</div>
          </div>
          <div className="rounded bg-slate-50 p-2">
            <div className="text-lg font-bold text-slate-600">{result.summary.resources_skipped}</div>
            <div className="text-slate-500">Omitidos</div>
          </div>
          <div className="rounded bg-orange-50 p-2">
            <div className="text-lg font-bold text-orange-700">{result.summary.resources_conflicted}</div>
            <div className="text-slate-500">Conflictos</div>
          </div>
          <div className="rounded bg-red-50 p-2">
            <div className="text-lg font-bold text-red-700">{result.summary.resources_failed}</div>
            <div className="text-slate-500">Fallidos</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Dominios ({result.domain_results.length})</h3>
        {result.domain_results.map(d => (
          <DomainSection key={d.domain_key} domain={d} />
        ))}
      </div>
    </div>
  )
}
