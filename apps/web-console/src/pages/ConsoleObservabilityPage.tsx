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
import { useConsolePermissions } from '@/lib/console-permissions'

const TENANT_SCOPE_METRICS_RANGE: ConsoleMetricRange = { preset: '24h' }

type AuditExportFeedback =
  | { kind: 'loading' }
  | { kind: 'artifact'; manifest: ConsoleAuditExportManifest }
  | { kind: 'unavailable'; result: ConsoleAuditExportResult; message: string }
  | { kind: 'error'; message: string }

const auditExportStatusLabels: Record<string, string> = {
  accepted: 'Aceptado',
  completed: 'Completado',
  failed: 'Fallido',
  queued: 'En cola'
}

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

function auditExportStatusLabel(result: ConsoleAuditExportResult): string | null {
  const status = auditExportStatus(result)
  return status ? auditExportStatusLabels[status] ?? status : null
}

function auditExportUnavailableMessage(result: ConsoleAuditExportResult): string {
  if (result && typeof result === 'object' && typeof result.message === 'string' && result.message.trim()) {
    return result.message.trim()
  }

  const status = auditExportStatus(result)
  if (status) {
    return `El servidor devolvió estado ${status}, pero no incluyó un manifiesto descargable.`
  }

  return 'El servidor respondió sin un manifiesto descargable para esta solicitud.'
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
  // #761: `tenant_developer` is the one tenant-tier role denied `tenant.audit.read` in
  // authorization-model.json (the viewer IS allowed it — that asymmetry is the entire point of the
  // developer role's "directory read, no audit" intent). Don't offer an audit destination that
  // would 403 for them (Observer-first IA, scenario 5).
  const { can } = useConsolePermissions()
  const canReadAudit = can('tenant.audit.read')

  const metrics = useConsoleMetrics(activeTenantId, activeWorkspaceId, range)
  // Round-2 review (#761): `useConsoleAuditRecords` was called unconditionally regardless of
  // `canReadAudit`, so a `tenant_developer` (denied `tenant.audit.read`, and whose default landing
  // is now this page — Observer-first IA) fired a background GET .../audit-records that 403s on
  // every visit, even though the "Auditoría" tab is already hidden for them. `useConsoleAuditRecords`
  // already no-ops on a falsy `tenantId` (see its `if (!tenantId) { ...; return }` guard in
  // console-metrics.ts), so passing `null` here — the same gate-by-null-id pattern the hook itself
  // uses — suppresses the fetch without a conditional hook call. Behavior for a role that CAN read
  // audit is unchanged (the real `activeTenantId`/`activeWorkspaceId` still flow through).
  const audit = useConsoleAuditRecords(canReadAudit ? activeTenantId : null, canReadAudit ? activeWorkspaceId : null, filters)
  const metricsRangeApplies = Boolean(activeWorkspaceId)

  const headerText = useMemo(() => {
    return [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · ')
  }, [activeTenant?.label, activeWorkspace?.label])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Observabilidad bloqueada" description="Selecciona una organización para consultar métricas y auditoría." />
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
            <p className="text-sm text-muted-foreground">{headerText || 'Organización activa'}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Observabilidad</h1>
          </div>
          {metrics.overview ? <ConsoleQuotaPostureBadge posture={metrics.overview.overallPosture} linkTo="/console/quotas" /> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={tab === 'metrics' ? 'default' : 'outline'} onClick={() => setTab('metrics')}>Métricas</Button>
          {canReadAudit ? (
            <Button type="button" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>Auditoría</Button>
          ) : null}
        </div>
      </header>

      {tab === 'metrics' ? (
        <div className="space-y-4">
          <ConsoleTimeRangeSelector
            value={metricsRangeApplies ? range : TENANT_SCOPE_METRICS_RANGE}
            onChange={setRange}
            disabled={!metricsRangeApplies}
            disabledReason={!metricsRangeApplies ? 'El rango temporal no está activo para métricas de organización. Selecciona un área de trabajo en el contexto de consola para consultar series con ventana temporal.' : undefined}
          />
          {metrics.loading ? <ConsolePageState kind="loading" title="Cargando métricas" description="Consultando resumen e instantánea de uso." /> : null}
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
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Actor</span>
                <input aria-label="Actor" value={filters.actorId ?? ''} onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value || undefined }))} className="w-full min-w-[10rem] rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Categoría</span>
                <input aria-label="Categoría" value={filters.category ?? ''} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value || undefined }))} className="w-full min-w-[10rem] rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Resultado</span>
                <select aria-label="Resultado" value={filters.result ?? ''} onChange={(event) => setFilters((current) => ({ ...current, result: (event.target.value || undefined) as ConsoleAuditFilter['result'] }))} className="w-full min-w-[10rem] rounded-xl border border-input bg-background px-3 py-2">
                  <option value="">Todos</option>
                  <option value="success">Éxito</option>
                  <option value="failure">Fallo</option>
                </select>
              </label>
              {/* #766: `ConsoleAuditFilter.from`/`.to` were already modeled and wired into the
                  fetch (`appendDateFilters`), but the audit tab never exposed inputs for them. */}
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Desde</span>
                <input type="date" aria-label="Desde" value={filters.from ?? ''} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value || undefined }))} className="rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <label className="text-sm font-medium">
                <span className="mb-1 block text-muted-foreground">Hasta</span>
                <input type="date" aria-label="Hasta" value={filters.to ?? ''} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value || undefined }))} className="rounded-xl border border-input bg-background px-3 py-2" />
              </label>
              <div className="ml-auto flex">
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
                        Estamos esperando la respuesta del servidor para saber si hay un manifiesto JSON descargable.
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
                          ID de exportación <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{exportFeedback.manifest.exportId}</code>
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={() => downloadAuditExportManifest(exportFeedback.manifest)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Descargar JSON
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
                      <dd className="font-medium">{auditExportStatusLabel(exportFeedback.manifest) ?? 'Completado'}</dd>
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
            <>
              {/* #766 audit triage depth: `useConsoleAuditRecords` hard-codes `page[size]=50` and
                  returns no cursor/hasMore, so there is nothing to paginate against — surface the
                  count and the cap honestly instead of inventing pagination the backend doesn't
                  support. */}
              <p className="text-sm text-muted-foreground">
                {audit.records.length} {audit.records.length === 1 ? 'evento mostrado' : 'eventos mostrados'}
                {audit.records.length >= 50 ? ' · límite de 50 por consulta; ajusta los filtros para acotar los resultados' : ''}
              </p>
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
                    {audit.records.map((record) => {
                      const isExpanded = expandedRecordId === record.eventId
                      const detailId = `audit-record-detail-${record.eventId}`
                      return (
                        <Fragment key={record.eventId}>
                          <tr className="border-b border-border/60">
                            <td className="px-4 py-3">
                              <Button
                                type="button"
                                variant="link"
                                className="h-auto whitespace-normal break-all p-0 font-mono text-sm"
                                aria-expanded={isExpanded}
                                aria-controls={detailId}
                                onClick={() => setExpandedRecordId((current) => current === record.eventId ? null : record.eventId)}
                              >
                                {record.eventId}
                              </Button>
                            </td>
                            <td className="px-4 py-3"><ConsoleAuditCategoryBadge category={record.action.category} /></td>
                            <td className="px-4 py-3"><ConsoleAuditResultBadge result={record.result?.outcome ?? 'unknown'} /></td>
                            <td className="px-4 py-3">{record.eventTimestamp}</td>
                          </tr>
                          {isExpanded ? (
                            <tr>
                              <td id={detailId} className="px-4 py-3" colSpan={4}><ConsoleAuditRecordDetail record={record} /></td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  )
}
