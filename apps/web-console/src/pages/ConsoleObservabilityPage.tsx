import { Fragment, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConsoleAuditCategoryBadge } from '@/components/console/ConsoleAuditCategoryBadge'
import { ConsoleAuditRecordDetail } from '@/components/console/ConsoleAuditRecordDetail'
import { ConsoleAuditResultBadge } from '@/components/console/ConsoleAuditResultBadge'
import { ConsoleMetricDimensionRow } from '@/components/console/ConsoleMetricDimensionRow'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { ConsoleTimeRangeSelector } from '@/components/console/ConsoleTimeRangeSelector'
import {
  exportAuditRecords,
  useConsoleAuditRecords,
  useConsoleMetrics,
  type ConsoleAuditExportManifest,
  type ConsoleAuditExportResult,
  type ConsoleAuditFilter,
  type ConsoleMetricRange
} from '@/lib/console-metrics'
import { useConsoleContext } from '@/lib/console-context'

type AuditExportFeedback =
  | { kind: 'loading' }
  | { kind: 'artifact'; manifest: ConsoleAuditExportManifest }
  | { kind: 'unavailable'; result: ConsoleAuditExportResult; message: string }
  | { kind: 'error'; message: string }

function isAuditExportManifest(result: ConsoleAuditExportResult): result is ConsoleAuditExportManifest {
  return Boolean(
    result &&
      typeof result === 'object' &&
      typeof result.exportId === 'string' &&
      result.exportId.length > 0 &&
      typeof result.itemCount === 'number' &&
      Array.isArray(result.items)
  )
}

function auditExportStatus(result: ConsoleAuditExportResult): string | null {
  return result && typeof result === 'object' && typeof result.status === 'string' && result.status.trim()
    ? result.status.trim()
    : null
}

function auditExportId(result: ConsoleAuditExportResult): string | null {
  return result && typeof result === 'object' && typeof result.exportId === 'string' && result.exportId.trim()
    ? result.exportId.trim()
    : null
}

function auditExportUnavailableMessage(result: ConsoleAuditExportResult): string {
  if (result && typeof result === 'object' && typeof result.message === 'string' && result.message.trim()) {
    return result.message.trim()
  }

  const status = auditExportStatus(result)
  if (status) {
    return `El backend devolvió estado ${status}, pero no incluyó un manifiesto descargable.`
  }

  return 'El backend respondió sin un manifiesto descargable para esta solicitud.'
}

function auditExportErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }

  return 'No se pudo exportar la auditoría.'
}

function downloadAuditExportManifest(manifest: ConsoleAuditExportManifest) {
  const filename = `${manifest.exportId.replace(/[^a-zA-Z0-9_.-]/g, '-') || 'audit-export'}.json`
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ConsoleObservabilityPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const [tab, setTab] = useState<'metrics' | 'audit'>('metrics')
  const [range, setRange] = useState<ConsoleMetricRange>({ preset: '24h' })
  const [filters, setFilters] = useState<ConsoleAuditFilter>({})
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const [exportFeedback, setExportFeedback] = useState<AuditExportFeedback | null>(null)

  const metrics = useConsoleMetrics(activeTenantId, activeWorkspaceId, range)
  const audit = useConsoleAuditRecords(activeTenantId, activeWorkspaceId, filters)

  const headerText = useMemo(() => {
    return [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · ')
  }, [activeTenant?.label, activeWorkspace?.label])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Observabilidad bloqueada" description="Selecciona un tenant para consultar métricas y auditoría." />
  }

  const tenantId = activeTenantId
  const isExporting = exportFeedback?.kind === 'loading'
  const exportFeedbackId = exportFeedback ? 'audit-export-feedback' : undefined

  async function handleExport() {
    setExportFeedback({ kind: 'loading' })

    try {
      const result = await exportAuditRecords(tenantId, activeWorkspaceId, filters)
      if (isAuditExportManifest(result)) {
        setExportFeedback({ kind: 'artifact', manifest: result })
        return
      }

      setExportFeedback({ kind: 'unavailable', result, message: auditExportUnavailableMessage(result) })
    } catch (error) {
      setExportFeedback({ kind: 'error', message: auditExportErrorMessage(error) })
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-3 rounded-3xl border border-border bg-card/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{headerText || 'Tenant activo'}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Observability</h1>
          </div>
          {metrics.overview ? <ConsoleQuotaPostureBadge posture={metrics.overview.overallPosture} /> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={tab === 'metrics' ? 'default' : 'outline'} onClick={() => setTab('metrics')}>Metrics</Button>
          <Button type="button" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Audit</Button>
        </div>
      </header>

      {tab === 'metrics' ? (
        <div className="space-y-4">
          <ConsoleTimeRangeSelector value={range} onChange={setRange} />
          {metrics.loading ? <ConsolePageState kind="loading" title="Cargando métricas" description="Consultando overview y snapshot de uso." /> : null}
          {metrics.error ? <ConsolePageState kind="error" title="No se pudieron cargar las métricas" description={metrics.error} actionLabel="Reintentar" onAction={metrics.reload} /> : null}
          {!metrics.loading && !metrics.error && metrics.overview && metrics.overview.dimensions.length === 0 ? (
            <ConsolePageState kind="empty" title="Sin métricas en este periodo" description="No hay dimensiones disponibles para el rango temporal seleccionado." />
          ) : null}
          {metrics.overview ? (
            <section className="space-y-4">
              <p className="text-sm text-muted-foreground">Última actualización: {metrics.overview.generatedAt || 'n/a'}</p>
              {metrics.overview.dimensions.map((dimension) => (
                <ConsoleMetricDimensionRow key={dimension.dimensionId} dimension={dimension} />
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Actor</span>
                <input aria-label="Actor" value={filters.actorId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Categoría</span>
                <input aria-label="Categoría" value={filters.category ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || undefined }))} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Resultado</span>
                <select aria-label="Resultado" value={filters.result ?? ''} onChange={(event) => setFilters((current) => ({ ...current, result: (event.target.value || undefined) as ConsoleAuditFilter['result'] }))} className="w-full rounded-xl border border-input bg-background px-3 py-2">
                  <option value="">Todos</option>
                  <option value="success">success</option>
                  <option value="failure">failure</option>
                </select>
              </label>
              <div className="flex md:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full md:w-auto"
                  disabled={isExporting}
                  aria-busy={isExporting}
                  aria-describedby={exportFeedbackId}
                  onClick={() => void handleExport()}
                >
                  {isExporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                  {isExporting ? 'Exportando auditoría...' : 'Exportar auditoría'}
                </Button>
              </div>
            </div>
          </section>
          {exportFeedback ? (
            <div id="audit-export-feedback" aria-live="polite" aria-atomic="true" className="space-y-3">
              {exportFeedback.kind === 'loading' ? (
                <section role="status" aria-busy="true" className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Solicitando exportación de auditoría</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Estamos esperando la respuesta del backend para saber si hay un manifiesto JSON descargable.
                      </p>
                    </div>
                  </div>
                </section>
              ) : null}
              {exportFeedback.kind === 'artifact' ? (
                <section role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">Manifiesto de auditoría listo</h2>
                        <p className="break-words text-sm leading-6 text-muted-foreground">
                          Export ID <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{exportFeedback.manifest.exportId}</code>
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={() => downloadAuditExportManifest(exportFeedback.manifest)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Descargar manifiesto JSON
                    </Button>
                  </div>
                  <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-emerald-500/20 pt-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Registros exportados</dt>
                      <dd className="font-medium">{exportFeedback.manifest.itemCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Registros enmascarados</dt>
                      <dd className="font-medium">{exportFeedback.manifest.maskedItemCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Estado</dt>
                      <dd className="font-medium">{auditExportStatus(exportFeedback.manifest) ?? 'completed'}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}
              {exportFeedback.kind === 'unavailable' ? (
                <section role="status" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Manifiesto no disponible</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{exportFeedback.message}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        No se descargó ningún archivo porque la respuesta no incluyó un manifiesto.
                      </p>
                      {auditExportId(exportFeedback.result) ? (
                        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                          Solicitud <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{auditExportId(exportFeedback.result)}</code>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}
              {exportFeedback.kind === 'error' ? (
                <section role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 shadow-sm sm:p-5">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">No se pudo exportar la auditoría</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{exportFeedback.message}</p>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
          {audit.loading ? <ConsolePageState kind="loading" title="Cargando auditoría" description="Consultando eventos auditables." /> : null}
          {audit.error ? <ConsolePageState kind="error" title="No se pudo cargar la auditoría" description={audit.error} actionLabel="Reintentar" onAction={audit.reload} /> : null}
          {!audit.loading && !audit.error && audit.records.length === 0 ? <ConsolePageState kind="empty" title="Sin eventos de auditoría" description="No se encontraron registros con los filtros actuales." /> : null}
          {audit.records.length > 0 ? (
            <div className="overflow-hidden rounded-3xl border border-border bg-card/70">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3">Evento</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3">Resultado</th>
                    <th className="px-4 py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.records.map((record) => (
                    <Fragment key={record.eventId}>
                      <tr className="border-b border-border/60">
                        <td className="px-4 py-3">
                          <button type="button" className="font-medium underline" onClick={() => setExpandedRecordId((current) => current === record.eventId ? null : record.eventId)}>
                            {record.eventId}
                          </button>
                        </td>
                        <td className="px-4 py-3"><ConsoleAuditCategoryBadge category={record.action.category} /></td>
                        <td className="px-4 py-3"><ConsoleAuditResultBadge result={record.result?.outcome ?? 'unknown'} /></td>
                        <td className="px-4 py-3">{record.eventTimestamp}</td>
                      </tr>
                      {expandedRecordId === record.eventId ? (
                        <tr>
                          <td className="px-4 py-3" colSpan={4}><ConsoleAuditRecordDetail record={record} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
