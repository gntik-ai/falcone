import { useCallback, useEffect, useState } from 'react'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import { PlanCapabilityBadge } from '@/components/console/PlanCapabilityBadge'
import { PlanLimitsTable, type PlanLimitRowStatus } from '@/components/console/PlanLimitsTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { describeConsoleError } from '@/lib/console-errors'
import { cn } from '@/lib/utils'
import * as api from '@/services/planManagementApi'
import { AlertTriangle, Archive, ArrowLeft, Ban, CheckCircle2, Circle, Info, Rocket, Trash2, Users } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

type PlanDetailTab = 'info' | 'capabilities' | 'limits' | 'tenants'
type LimitFeedback = { kind: 'success' | 'error'; title: string; message: string } | null
type ActionFeedback = { kind: 'success' | 'error'; title: string; message: string } | null
type LimitMutationOptions = { showPageError?: boolean }
type BusyPlanAction = `lifecycle:${api.PlanStatus}` | 'delete'
type PlanLifecycleAction = {
  targetStatus: api.PlanStatus
  label: string
  description: string
  destructive: boolean
}

const planDetailTabs: Array<{ value: PlanDetailTab; label: string }> = [
  { value: 'info', label: 'Información' },
  { value: 'capabilities', label: 'Capacidades' },
  { value: 'limits', label: 'Límites' },
  { value: 'tenants', label: 'Asignaciones de organizaciones' }
]

const lifecycleStatuses: api.PlanStatus[] = ['draft', 'active', 'deprecated', 'archived']

const lifecycleStatusSummaries: Record<api.PlanStatus, string> = {
  draft: 'Configurable',
  active: 'Asignable',
  deprecated: 'En retirada',
  archived: 'Retirado'
}

function limitErrorMessage(error: unknown): string {
  const candidate = error as Partial<api.PlanApiError>
  const code = typeof candidate?.code === 'string' ? candidate.code : null

  if (code === 'INVALID_LIMIT_VALUE') {
    return 'INVALID_LIMIT_VALUE: usa -1 para indicar sin límite, 0 o un número entero positivo.'
  }
  if (code === 'PLAN_LIMITS_FROZEN') {
    return 'PLAN_LIMITS_FROZEN: este plan ya no acepta cambios de límites.'
  }

  // Codes above are console-owned copy for a narrow, known allow-list of 4xx codes (#743's
  // proposal note on preserving genuinely user-facing backend validation copy). Anything else —
  // an unrecognized code, or no code at all — must never echo the raw transport message.
  const message = describeConsoleError(error, 'La solicitud falló.')
  return code && !message.includes(code) ? `${code}: ${message}` : message
}

function planActionErrorMessage(error: unknown): string {
  const candidate = error as Partial<api.PlanApiError>
  const code = typeof candidate?.code === 'string' ? candidate.code : null

  if (code === 'PLAN_HAS_ASSIGNMENT_HISTORY') {
    return 'PLAN_HAS_ASSIGNMENT_HISTORY: la API rechazó la eliminación porque este plan tiene asignaciones activas o históricas. Archívalo para retirarlo sin romper el historial.'
  }
  if (code === 'PLAN_HAS_ACTIVE_ASSIGNMENTS') {
    return 'PLAN_HAS_ACTIVE_ASSIGNMENTS: el plan tiene organizaciones activas asignadas. Cambia esas asignaciones antes de continuar.'
  }
  if (code === 'PLAN_ACTIVE') {
    return 'PLAN_ACTIVE: primero marca el plan como obsoleto y archívalo; los planes activos no se eliminan directamente.'
  }
  if (code === 'INVALID_TRANSITION') {
    return 'INVALID_TRANSITION: esta transición no está permitida para el estado actual del plan.'
  }

  // Codes above are console-owned copy for a narrow, known allow-list of 4xx codes (#743's
  // proposal note on preserving genuinely user-facing backend validation copy). Anything else —
  // an unrecognized code, or no code at all — must never echo the raw transport message.
  const message = describeConsoleError(error, 'La solicitud falló.')
  return code && !message.includes(code) ? `${code}: ${message}` : message
}

function lifecycleGuidance(status: api.PlanStatus, action: PlanLifecycleAction | null): string {
  if (action) return action.description
  if (status === 'archived') return 'El plan ya está archivado y no tiene más transiciones de ciclo de vida.'
  return 'No hay transiciones disponibles para el estado actual del plan.'
}

function assignedTenantSummary(count: number | null): string {
  if (count === null) return 'Asignaciones activas: no disponibles en este detalle.'
  if (count === 0) return 'No hay organizaciones activas asignadas a este plan.'
  if (count === 1) return '1 organización activa usa este plan.'
  return `${count} organizaciones activas usan este plan.`
}

function affectedTenantResetSummary(count: number | null): string {
  if (count === null) return 'El número de organizaciones afectadas no está disponible en este detalle.'
  if (count === 0) return 'Actualmente no hay organizaciones activas afectadas.'
  if (count === 1) return 'Afecta a 1 organización activa asignada a este plan.'
  return `Afecta a ${count} organizaciones activas asignadas a este plan.`
}

function statusLabel(status: api.PlanStatus): string {
  return {
    draft: 'borrador',
    active: 'activo',
    deprecated: 'obsoleto',
    archived: 'archivado'
  }[status]
}

function statusDisplayLabel(status: api.PlanStatus): string {
  return {
    draft: 'Borrador',
    active: 'Activo',
    deprecated: 'Obsoleto',
    archived: 'Archivado'
  }[status]
}

function limitEditingTitle(plan: api.PlanRecord, assignedTenantCount: number | null): string {
  if (plan.status === 'draft') return 'Editando borrador'
  if (plan.status === 'active') {
    if (assignedTenantCount === 0) return 'Editando plan activo sin asignaciones'
    return 'Editando plan activo'
  }
  return 'Límites de solo lectura'
}

function limitEditingDescription(plan: api.PlanRecord, assignedTenantCount: number | null): string {
  if (plan.status === 'draft') {
    return 'Estos cambios preparan el catálogo antes de asignarlo a organizaciones. Escribe un valor entero y usa Guardar para confirmar cada fila.'
  }
  if (plan.status === 'active') {
    return `${affectedTenantResetSummary(assignedTenantCount)} Escribe un valor entero y usa Guardar para confirmar cada fila; Restablecer pide confirmación porque cambia derechos efectivos.`
  }
  return `El plan está ${statusLabel(plan.status)}; sus límites ya no aceptan edición desde esta vista.`
}

function getLifecycleAction(status: api.PlanStatus): PlanLifecycleAction | null {
  if (status === 'draft') {
    return {
      targetStatus: 'active',
      label: 'Activar plan',
      description: 'El plan quedará disponible para nuevas asignaciones.',
      destructive: false
    }
  }
  if (status === 'active') {
    return {
      targetStatus: 'deprecated',
      label: 'Marcar como obsoleto',
      description: 'El plan dejará de ser la opción recomendada para nuevas asignaciones.',
      destructive: true
    }
  }
  if (status === 'deprecated') {
    return {
      targetStatus: 'archived',
      label: 'Archivar plan',
      description: 'El plan quedará retirado. Esta transición es irreversible.',
      destructive: true
    }
  }
  return null
}

function mergeAcceptedSetResponse(rows: api.LimitProfileRow[], response: api.PlanLimitSetResponse): api.LimitProfileRow[] {
  return rows.map((row) => row.dimensionKey === response.dimensionKey ? {
    ...row,
    effectiveValue: response.newValue,
    source: response.source,
    unlimitedSentinel: response.newValue === -1,
    quotaType: response.quotaType ?? row.quotaType,
    graceMargin: response.graceMargin ?? row.graceMargin
  } : row)
}

function mergeAcceptedRemoveResponse(rows: api.LimitProfileRow[], response: api.PlanLimitRemoveResponse): api.LimitProfileRow[] {
  return rows.map((row) => row.dimensionKey === response.dimensionKey ? {
    ...row,
    effectiveValue: response.effectiveValue,
    source: response.source,
    unlimitedSentinel: response.effectiveValue === -1
  } : row)
}

export function ConsolePlanDetailPage() {
  const { planId = '' } = useParams()
  const navigate = useNavigate()
  const destructiveOp = useDestructiveOp()
  const [plan, setPlan] = useState<api.PlanRecord | null>(null)
  const [profile, setProfile] = useState<api.LimitProfileRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<PlanDetailTab>('info')
  const [limitFeedback, setLimitFeedback] = useState<LimitFeedback>(null)
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null)
  const [busyPlanAction, setBusyPlanAction] = useState<BusyPlanAction | null>(null)
  const [busyDimensionKey, setBusyDimensionKey] = useState<string | null>(null)
  const [limitRowStatuses, setLimitRowStatuses] = useState<Record<string, PlanLimitRowStatus | undefined>>({})

  const refreshLimitProfile = useCallback(async () => {
    const limits = await api.getPlanLimitsProfile(planId)
    setProfile(limits.profile)
    return limits.profile
  }, [planId])

  useEffect(() => {
    let cancelled = false

    async function loadPlan() {
      try {
        const [nextPlan, limits] = await Promise.all([
          api.getPlan(planId) as Promise<api.PlanRecord>,
          api.getPlanLimitsProfile(planId)
        ])
        if (cancelled) return
        setPlan(nextPlan)
        setProfile(limits.profile)
        setError(null)
        setLimitFeedback(null)
        setActionFeedback(null)
        setLimitRowStatuses({})
      } catch (fetchError) {
        if (!cancelled) setError(describeConsoleError(fetchError, 'No se pudo cargar el plan.'))
      }
    }

    void loadPlan()

    return () => {
      cancelled = true
    }
  }, [planId])

  async function restorePersistedLimitProfile() {
    try {
      await refreshLimitProfile()
    } catch {
      setProfile((current) => [...current])
    }
  }

  function setLimitRowStatus(key: string, status: PlanLimitRowStatus) {
    setLimitRowStatuses((current) => ({ ...current, [key]: status }))
  }

  async function handleLimitUpdate(key: string, value: number) {
    if (!plan) return
    setBusyDimensionKey(key)
    setLimitRowStatus(key, { state: 'saving', message: 'Guardando' })
    setLimitFeedback(null)
    try {
      let result: api.PlanLimitSetResponse
      try {
        result = await api.setPlanLimit(plan.id, key, value)
      } catch (caught) {
        const message = limitErrorMessage(caught)
        await restorePersistedLimitProfile()
        setLimitRowStatus(key, { state: 'failed', message: 'No se guardó' })
        setLimitFeedback({
          kind: 'error',
          title: 'El límite no se guardó',
          message
        })
        return
      }

      setProfile((current) => mergeAcceptedSetResponse(current, result))
      try {
        await refreshLimitProfile()
      } catch {
        setProfile((current) => [...current])
      }
      setLimitRowStatus(key, { state: 'saved', message: 'Guardado' })
      setLimitFeedback({
        kind: 'success',
        title: 'Límite guardado',
        message: `${key} fue aceptado por la API y la fila se reconcilió con el perfil guardado.`
      })
    } finally {
      setBusyDimensionKey(null)
    }
  }

  async function handleLimitReset(key: string, options: LimitMutationOptions = {}) {
    if (!plan) return
    const showPageError = options.showPageError ?? true
    setBusyDimensionKey(key)
    setLimitRowStatus(key, { state: 'saving', message: 'Restableciendo' })
    setLimitFeedback(null)
    try {
      let result: api.PlanLimitRemoveResponse
      try {
        result = await api.removePlanLimit(plan.id, key)
      } catch (caught) {
        const message = limitErrorMessage(caught)
        await restorePersistedLimitProfile()
        setLimitRowStatus(key, { state: 'failed', message: 'No se restableció' })
        setLimitFeedback({
          kind: 'error',
          title: 'No se pudo restablecer el límite',
          message
        })
        if (!showPageError) {
          throw Object.assign(caught instanceof Error ? caught : new Error(message), { message, preLocalized: true })
        }
        return
      }

      setProfile((current) => mergeAcceptedRemoveResponse(current, result))
      try {
        await refreshLimitProfile()
      } catch {
        setProfile((current) => [...current])
      }
      setLimitRowStatus(key, { state: 'saved', message: 'Restablecido' })
      setLimitFeedback({
        kind: 'success',
        title: 'Límite restablecido',
        message: `${key} ahora refleja el valor predeterminado devuelto por la API.`
      })
    } finally {
      setBusyDimensionKey(null)
    }
  }

  function openLimitResetConfirmation(dimension: api.LimitProfileRow) {
    if (!plan) return
    const activeCopy = plan.status === 'active'
      ? `${affectedTenantResetSummary(activeAssignmentCount)} Las organizaciones verán el valor efectivo devuelto por el plan después de confirmar.`
      : 'El plan no está activo; aun así, Restablecer elimina el valor explícito de esta dimensión.'

    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: `reset-plan-limit-${dimension.dimensionKey}`,
      resourceName: dimension.displayLabel,
      resourceType: 'límite del plan',
      resourceId: plan.id,
      impactDescription: `${activeCopy} La fila se reconciliará con el valor persistido que devuelva la API.`,
      onConfirm: () => handleLimitReset(dimension.dimensionKey, { showPageError: false })
    })
  }

  async function handleLifecycleTransition(targetStatus: api.PlanStatus, options: { showPageError?: boolean } = {}) {
    if (!plan) return
    const showPageError = options.showPageError ?? true
    setBusyPlanAction(`lifecycle:${targetStatus}`)
    setActionFeedback(null)
    try {
      const response = await api.transitionPlanLifecycle(plan.id, { targetStatus })
      setPlan((current) => current ? { ...current, status: response.newStatus, updatedAt: response.transitionedAt ?? current.updatedAt } : current)
      try {
        setPlan(await api.getPlan(plan.id))
      } catch {
        setPlan((current) => current ? { ...current } : current)
      }
      setActionFeedback({
        kind: 'success',
        title: 'Estado del plan actualizado',
        message: `${plan.displayName} ahora está ${statusLabel(response.newStatus)}.`
      })
    } catch (caught) {
      const message = planActionErrorMessage(caught)
      if (showPageError) {
        setActionFeedback({
          kind: 'error',
          title: 'No se pudo actualizar el estado',
          message
        })
        return
      }
      throw Object.assign(caught instanceof Error ? caught : new Error(message), { message, preLocalized: true })
    } finally {
      setBusyPlanAction(null)
    }
  }

  function openLifecycleConfirmation(action: PlanLifecycleAction) {
    if (!plan) return
    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: `plan-lifecycle-${action.targetStatus}`,
      resourceName: plan.displayName,
      resourceType: 'plan',
      resourceId: plan.id,
      impactDescription: action.description,
      onConfirm: () => handleLifecycleTransition(action.targetStatus, { showPageError: false })
    })
  }

  function openDeleteConfirmation() {
    if (!plan) return
    destructiveOp.openDialog({
      level: 'CRITICAL',
      operationId: 'delete-plan',
      resourceName: plan.displayName,
      resourceType: 'plan',
      resourceId: plan.id,
      impactDescription: 'La eliminación solo se permite para planes que nunca fueron asignados. Si el plan tiene historial, archívalo para retirarlo y conservar la trazabilidad.',
      onConfirm: async () => {
        setBusyPlanAction('delete')
        setActionFeedback(null)
        try {
          await api.deletePlan(plan.id)
        } catch (caught) {
          throw Object.assign(caught instanceof Error ? caught : new Error('No se pudo eliminar el plan.'), {
            message: planActionErrorMessage(caught),
            preLocalized: true
          })
        } finally {
          setBusyPlanAction(null)
        }
      },
      onSuccess: () => navigate('/console/plans')
    })
  }

  if (error) return <ConsolePageState kind="error" title="No se pudo cargar el plan" description={error} />
  if (!plan) return <ConsolePageState kind="loading" title="Cargando plan" description="Consultando el detalle del plan." />

  const limitEditingEnabled = plan.status === 'draft' || plan.status === 'active'
  const lifecycleAction = getLifecycleAction(plan.status)
  const controlsDisabled = busyPlanAction !== null || destructiveOp.opState === 'confirming'
  const currentLifecycleIndex = lifecycleStatuses.indexOf(plan.status)
  const capabilityEntries = Object.entries(plan.capabilities ?? {})
  const activeAssignmentCount = typeof plan.assignedTenantCount === 'number' ? plan.assignedTenantCount : null
  const lifecycleHelp = lifecycleGuidance(plan.status, lifecycleAction)
  const planDescription = plan.description?.trim()
  const deleteBlockedByActiveStatus = plan.status === 'active'
  const deleteDisabled = controlsDisabled || deleteBlockedByActiveStatus

  return (
    <section aria-labelledby="plan-detail-heading">
      <Tabs value={tab} onValueChange={(value) => setTab(value as PlanDetailTab)} className="gap-6">
      <header className="overflow-hidden rounded-3xl border border-border bg-card/70 shadow-sm">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlanStatusBadge status={plan.status} />
                <span className="rounded-md border border-border bg-background/60 px-2 py-1 font-mono text-xs text-muted-foreground">
                  {plan.slug}
                </span>
              </div>
              <div className="space-y-2">
                <h1 id="plan-detail-heading" className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{plan.displayName}</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Administra el estado del plan, sus límites base y las asignaciones que consumen este catálogo.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
              <Button variant="outline" asChild className="w-full min-w-[10rem] sm:w-auto">
                <Link to="/console/plans">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Volver al catálogo
                </Link>
              </Button>
              {lifecycleAction ? (
                <Button
                  type="button"
                  variant={lifecycleAction.destructive ? 'outline' : 'default'}
                  className={cn(
                    'w-full min-w-[11rem] sm:w-auto',
                    lifecycleAction.destructive && 'border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive'
                  )}
                  onClick={() => lifecycleAction.destructive ? openLifecycleConfirmation(lifecycleAction) : void handleLifecycleTransition(lifecycleAction.targetStatus)}
                  disabled={controlsDisabled}
                  aria-busy={busyPlanAction === `lifecycle:${lifecycleAction.targetStatus}`}
                  aria-describedby="plan-lifecycle-help"
                  aria-label={`${lifecycleAction.label} ${plan.displayName}${busyPlanAction === `lifecycle:${lifecycleAction.targetStatus}` ? ' en curso' : ''}`}
                >
                  {lifecycleAction.targetStatus === 'active' ? <Rocket className="h-4 w-4" aria-hidden="true" /> : null}
                  {lifecycleAction.targetStatus === 'deprecated' ? <Ban className="h-4 w-4" aria-hidden="true" /> : null}
                  {lifecycleAction.targetStatus === 'archived' ? <Archive className="h-4 w-4" aria-hidden="true" /> : null}
                  {busyPlanAction === `lifecycle:${lifecycleAction.targetStatus}` ? 'Actualizando…' : lifecycleAction.label}
                </Button>
              ) : null}
              <div className="flex w-full pt-1 sm:w-auto sm:border-l sm:border-border sm:pl-3 sm:pt-0">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full min-w-[9.5rem] sm:w-auto"
                  onClick={openDeleteConfirmation}
                  disabled={deleteDisabled}
                  aria-busy={busyPlanAction === 'delete'}
                  aria-describedby="plan-delete-help"
                  aria-label={`Eliminar plan ${plan.displayName}${busyPlanAction === 'delete' ? ' en curso' : ''}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {busyPlanAction === 'delete' ? 'Eliminando…' : 'Eliminar plan'}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-5 border-t border-border/70 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <div className="min-w-0 space-y-4" aria-labelledby="plan-lifecycle-heading">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 id="plan-lifecycle-heading" className="text-sm font-semibold tracking-tight text-foreground">Ciclo de vida</h2>
            </div>
            <ol className="grid gap-4 sm:grid-cols-4" aria-label="Secuencia de estados del plan">
              {lifecycleStatuses.map((status, index) => {
                const isCurrent = status === plan.status
                const isCompleted = currentLifecycleIndex > index
                const isFuture = !isCurrent && !isCompleted

                return (
                  <li key={status} className="relative min-w-0">
                    {index < lifecycleStatuses.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute left-3.5 top-7 h-[calc(100%+1rem)] w-px sm:left-[1.75rem] sm:right-[-1rem] sm:top-3.5 sm:h-px sm:w-auto',
                          isCompleted ? 'bg-primary/60' : 'bg-border'
                        )}
                      />
                    ) : null}
                    <div className="relative flex min-h-10 items-start gap-3">
                      <span
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                          isCurrent && 'border-primary bg-primary text-primary-foreground',
                          isCompleted && 'border-primary/60 bg-primary/10 text-primary',
                          isFuture && 'border-border bg-muted/40 text-muted-foreground'
                        )}
                        aria-hidden="true"
                      >
                        {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : isFuture ? <Circle className="h-3 w-3" /> : index + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          aria-current={isCurrent ? 'step' : undefined}
                          className={cn('block text-sm font-medium leading-5', isFuture ? 'text-muted-foreground' : 'text-foreground')}
                        >
                          {statusDisplayLabel(status)}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{lifecycleStatusSummaries[status]}</span>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
            <p id="plan-lifecycle-help" className="max-w-3xl text-sm leading-6 text-muted-foreground">{lifecycleHelp}</p>
          </div>
          <div className="space-y-4 border-t border-border/70 pt-4 text-sm leading-6 text-muted-foreground lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div className="flex gap-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p>{assignedTenantSummary(activeAssignmentCount)}</p>
            </div>
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <p id="plan-delete-help">
                {deleteBlockedByActiveStatus
                  ? 'Los planes activos se retiran con “Marcar como obsoleto” antes de archivarlos o eliminarlos.'
                  : 'Eliminar solo debe usarse en planes nunca asignados. Si existe asignación activa o histórica, la API rechazará la acción y mostrará el motivo en la confirmación.'}
              </p>
            </div>
          </div>
        </div>
        <div className="border-t border-border/70 px-5 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Detalle del plan" className="inline-flex min-w-full gap-1 rounded-xl border border-border bg-background/50 p-1 sm:min-w-0">
              {planDetailTabs.map(({ value, label }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-8 shrink-0 rounded-md px-3 text-xs sm:text-sm"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
      </header>

      {actionFeedback ? (
        <Alert
          variant={actionFeedback.kind === 'error' ? 'destructive' : 'success'}
          role={actionFeedback.kind === 'error' ? 'alert' : 'status'}
          aria-live={actionFeedback.kind === 'error' ? 'assertive' : 'polite'}
          className="text-foreground"
        >
          <AlertTitle>{actionFeedback.title}</AlertTitle>
          <AlertDescription>{actionFeedback.message}</AlertDescription>
        </Alert>
      ) : null}

      <TabsContent
        value="info"
        className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
      >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Resumen del plan</h2>
              </div>
              {planDescription ? (
                <p className="leading-7 text-foreground">{planDescription}</p>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">Este plan no tiene una descripción registrada.</p>
              )}
            </div>
            <dl className="grid gap-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado</dt>
                <dd className="mt-1 text-foreground">{statusDisplayLabel(plan.status)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Asignaciones</dt>
                <dd className="mt-1 text-foreground">{activeAssignmentCount ?? 'No disponible'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actualizado</dt>
                <dd className="mt-1 break-words text-foreground">{plan.updatedAt ?? 'Sin fecha'}</dd>
              </div>
            </dl>
          </div>
      </TabsContent>

      <TabsContent
        value="capabilities"
        className="space-y-4 rounded-3xl border border-border bg-card/70 p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
      >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Capacidades</h2>
            <p className="text-sm leading-6 text-muted-foreground">Funciones habilitadas o bloqueadas para organizaciones asignadas a este plan.</p>
          </div>
          {capabilityEntries.length > 0 ? (
            <ul className="divide-y divide-border/70">
              {capabilityEntries.map(([key, enabled]) => (
                <li key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="break-words text-sm font-medium text-foreground">{key}</span>
                  <PlanCapabilityBadge enabled={Boolean(enabled)} label={key} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">Este plan no tiene capacidades configuradas.</p>
          )}
      </TabsContent>

      <TabsContent
        value="limits"
        className="space-y-5 rounded-3xl border border-border bg-card/70 p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
      >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Límites base</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {limitEditingEnabled
                ? 'Usa -1 para indicar sin límite. Los cambios quedan como borrador local hasta que guardas la fila.'
                : `Los límites son de solo lectura porque el plan está ${statusLabel(plan.status)}.`}
            </p>
          </div>
          <Alert
            variant={plan.status === 'active' ? 'warning' : 'default'}
            role="status"
            aria-live="polite"
            className="text-foreground"
          >
            <AlertTitle>{limitEditingTitle(plan, activeAssignmentCount)}</AlertTitle>
            <AlertDescription>{limitEditingDescription(plan, activeAssignmentCount)}</AlertDescription>
          </Alert>
          {limitFeedback ? (
            <Alert
              variant={limitFeedback.kind === 'error' ? 'destructive' : 'success'}
              role={limitFeedback.kind === 'error' ? 'alert' : 'status'}
              aria-live={limitFeedback.kind === 'error' ? 'assertive' : 'polite'}
              className="text-foreground"
            >
              <AlertTitle>{limitFeedback.title}</AlertTitle>
              <AlertDescription>{limitFeedback.message}</AlertDescription>
            </Alert>
          ) : null}
          {profile.length > 0 ? (
            <PlanLimitsTable
              dimensions={profile}
              editable={limitEditingEnabled}
              busyDimensionKey={busyDimensionKey}
              rowStatuses={limitRowStatuses}
              onUpdate={handleLimitUpdate}
              onResetRequest={openLimitResetConfirmation}
            />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">Este plan no tiene dimensiones de cuota configuradas.</p>
          )}
      </TabsContent>

      <TabsContent
        value="tenants"
        className="space-y-4 rounded-3xl border border-border bg-card/70 p-5 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
      >
          <div className="flex gap-3">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Organizaciones asignadas</h2>
              <p className="text-sm leading-6 text-foreground">{assignedTenantSummary(activeAssignmentCount)}</p>
              <p className="text-sm leading-6 text-muted-foreground">
                Para cambiar asignaciones, abre una organización y gestiona su plan desde el detalle de esa organización.
              </p>
            </div>
          </div>
          <Button variant="outline" asChild className="w-full sm:w-fit">
            <Link to="/console/tenants">Abrir organizaciones</Link>
          </Button>
      </TabsContent>
      </Tabs>

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}
