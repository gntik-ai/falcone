/**
 * Panel component showing the full preflight conflict report.
 */

import { useState } from 'react'
import { PreflightRiskBadge } from './PreflightRiskBadge'
import type { PreflightReport, DomainAnalysisResult, ConflictEntry } from '@/api/configPreflightApi'

interface PreflightConflictReportProps {
  report: PreflightReport
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/10 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/10 text-red-300 border-red-500/30',
}

const DOMAIN_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  analyzed: { label: 'Analizado', color: 'text-sky-300 bg-sky-500/10' },
  no_conflicts: { label: 'Sin conflictos', color: 'text-emerald-300 bg-emerald-500/10' },
  skipped_not_exportable: { label: 'No exportado', color: 'text-muted-foreground bg-muted/40' },
  analysis_error: { label: 'Error de análisis', color: 'text-red-300 bg-red-500/10' },
}

function ConflictDetail({ conflict }: { conflict: ConflictEntry }) {
  const [expanded, setExpanded] = useState(false)
  const colorClass = SEVERITY_COLORS[conflict.severity] ?? SEVERITY_COLORS.medium

  return (
    <div className={`rounded-md border p-3 space-y-2 ${colorClass}`} data-testid="conflict-entry">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{conflict.resource_type}</span>
          <span className="font-semibold text-sm">{conflict.resource_name}</span>
          <PreflightRiskBadge riskLevel={conflict.severity} size="sm" />
        </div>
        {conflict.diff && (
          <button
            type="button"
            className="text-xs underline"
            onClick={() => setExpanded(!expanded)}
            data-testid="toggle-diff"
          >
            {expanded ? 'Ocultar diff' : 'Ver diff'}
          </button>
        )}
      </div>

      <p className="text-xs">{conflict.recommendation}</p>

      {expanded && conflict.diff && (
        <pre className="mt-2 rounded bg-background/50 p-2 text-xs overflow-x-auto" data-testid="conflict-diff">
          {JSON.stringify(conflict.diff, null, 2)}
        </pre>
      )}
    </div>
  )
}

function DomainSection({ domain }: { domain: DomainAnalysisResult }) {
  const [expanded, setExpanded] = useState(domain.conflicts.length > 0)
  const statusInfo = DOMAIN_STATUS_LABEL[domain.status] ?? DOMAIN_STATUS_LABEL.analyzed

  return (
    <div className="border border-border rounded-lg" data-testid={`domain-section-${domain.domain_key}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 hover:bg-accent/40"
        onClick={() => setExpanded(!expanded)}
        data-testid={`domain-toggle-${domain.domain_key}`}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-foreground">{domain.domain_key}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          {domain.conflicts.length > 0 && (
            <span className="text-xs text-muted-foreground">{domain.conflicts.length} conflicto(s)</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="p-3 pt-0 space-y-2">
          {domain.status === 'analysis_error' && domain.analysis_error_message && (
            <div className="rounded-md bg-destructive/5 border border-destructive/30 p-2 text-xs text-destructive" data-testid="analysis-error">
              {domain.analysis_error_message}
            </div>
          )}
          {domain.conflicts.length === 0 && domain.status !== 'analysis_error' && (
            <p className="text-xs text-muted-foreground">Sin conflictos detectados en este dominio.</p>
          )}
          {domain.conflicts.map((c, i) => (
            <ConflictDetail key={`${c.resource_type}-${c.resource_name}-${i}`} conflict={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export function PreflightConflictReport({ report }: PreflightConflictReportProps) {
  const [showRedacted, setShowRedacted] = useState(false)
  const { summary } = report

  const redactedEntries = report.domains.flatMap(d => d.compatible_with_redacted ?? [])

  return (
    <div className="space-y-4" data-testid="preflight-report">
      {/* Executive summary */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 border border-border" data-testid="executive-summary">
        <PreflightRiskBadge riskLevel={summary.risk_level} size="lg" />
        <div className="flex-1 text-sm text-muted-foreground space-y-1">
          <div>Recursos analizados: <span className="font-semibold text-foreground">{summary.total_resources_analyzed}</span></div>
          <div>Compatibles: <span className="font-semibold text-foreground">{summary.compatible}</span></div>
          {summary.compatible_with_redacted_fields > 0 && (
            <div>Compatibles (con campos redactados): <span className="font-semibold text-foreground">{summary.compatible_with_redacted_fields}</span></div>
          )}
          <div className="flex gap-3">
            {Object.entries(summary.conflict_counts)
              .filter(([, v]) => v > 0)
              .map(([sev, count]) => (
                <span key={sev} className="text-xs">
                  {sev}: <span className="font-semibold text-foreground">{count}</span>
                </span>
              ))}
          </div>
        </div>
      </div>

      {/* Incomplete analysis warning */}
      {summary.incomplete_analysis && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300" data-testid="incomplete-warning">
          ⚠ Análisis incompleto. Los siguientes dominios no pudieron evaluarse:{' '}
          <span className="font-semibold">
            {summary.domains_skipped.filter(d =>
              report.domains.find(dr => dr.domain_key === d && dr.status === 'analysis_error')
            ).join(', ')}
          </span>
        </div>
      )}

      {/* Domain sections */}
      <div className="space-y-2" data-testid="domain-list">
        {report.domains.map(d => (
          <DomainSection key={d.domain_key} domain={d} />
        ))}
      </div>

      {/* Redacted resources section */}
      {redactedEntries.length > 0 && (
        <div className="border border-border rounded-lg">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 hover:bg-accent/40 text-sm"
            onClick={() => setShowRedacted(!showRedacted)}
            data-testid="toggle-redacted"
          >
            <span className="text-muted-foreground">Recursos con campos redactados ({redactedEntries.length})</span>
            <span className="text-xs text-muted-foreground">{showRedacted ? '▲' : '▼'}</span>
          </button>
          {showRedacted && (
            <div className="p-3 pt-0 space-y-1" data-testid="redacted-list">
              {redactedEntries.map((r, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  <span className="font-mono">{r.resource_type}</span> / <span className="font-semibold">{r.resource_name}</span>
                  — campos no comparados: {r.redacted_fields.join(', ')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
