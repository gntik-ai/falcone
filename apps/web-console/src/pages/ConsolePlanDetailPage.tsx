import { useCallback, useEffect, useState } from 'react'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import { PlanCapabilityBadge } from '@/components/console/PlanCapabilityBadge'
import { PlanLimitsTable } from '@/components/console/PlanLimitsTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import * as api from '@/services/planManagementApi'
import { useParams } from 'react-router-dom'

type PlanDetailTab = 'info' | 'capabilities' | 'limits' | 'tenants'
type LimitFeedback = { kind: 'success' | 'error'; title: string; message: string } | null

function limitErrorMessage(error: unknown): string {
  const candidate = error as Partial<api.PlanApiError>
  const code = typeof candidate?.code === 'string' ? candidate.code : null

  if (code === 'INVALID_LIMIT_VALUE') {
    return 'INVALID_LIMIT_VALUE: usa -1 para indicar sin límite, 0 o un número entero positivo.'
  }
  if (code === 'PLAN_LIMITS_FROZEN') {
    return 'PLAN_LIMITS_FROZEN: este plan ya no acepta cambios de límites.'
  }

  const message = error instanceof Error && error.message ? error.message : 'La solicitud falló.'
  return code && !message.includes(code) ? `${code}: ${message}` : message
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
  const [plan, setPlan] = useState<api.PlanRecord | null>(null)
  const [profile, setProfile] = useState<api.LimitProfileRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<PlanDetailTab>('info')
  const [limitFeedback, setLimitFeedback] = useState<LimitFeedback>(null)
  const [busyDimensionKey, setBusyDimensionKey] = useState<string | null>(null)

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
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Error')
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

  async function handleLimitUpdate(key: string, value: number) {
    if (!plan) return
    setBusyDimensionKey(key)
    setLimitFeedback(null)
    try {
      let result: api.PlanLimitSetResponse
      try {
        result = await api.setPlanLimit(plan.id, key, value)
      } catch (caught) {
        await restorePersistedLimitProfile()
        setLimitFeedback({
          kind: 'error',
          title: 'El límite no se guardó',
          message: limitErrorMessage(caught)
        })
        return
      }

      setProfile((current) => mergeAcceptedSetResponse(current, result))
      try {
        await refreshLimitProfile()
      } catch {
        setProfile((current) => [...current])
      }
      setLimitFeedback({
        kind: 'success',
        title: 'Límite guardado',
        message: `${key} fue aceptado por la API y la fila se reconcilió con el perfil guardado.`
      })
    } finally {
      setBusyDimensionKey(null)
    }
  }

  async function handleLimitReset(key: string) {
    if (!plan) return
    setBusyDimensionKey(key)
    setLimitFeedback(null)
    try {
      let result: api.PlanLimitRemoveResponse
      try {
        result = await api.removePlanLimit(plan.id, key)
      } catch (caught) {
        await restorePersistedLimitProfile()
        setLimitFeedback({
          kind: 'error',
          title: 'No se pudo restablecer el límite',
          message: limitErrorMessage(caught)
        })
        return
      }

      setProfile((current) => mergeAcceptedRemoveResponse(current, result))
      try {
        await refreshLimitProfile()
      } catch {
        setProfile((current) => [...current])
      }
      setLimitFeedback({
        kind: 'success',
        title: 'Límite restablecido',
        message: `${key} ahora refleja el valor predeterminado devuelto por la API.`
      })
    } finally {
      setBusyDimensionKey(null)
    }
  }

  if (error) return <ConsolePageState kind="error" title="No se pudo cargar el plan" description={error} />
  if (!plan) return <ConsolePageState kind="loading" title="Cargando plan" description="Consultando el detalle del plan." />

  const limitEditingEnabled = plan.status === 'draft' || plan.status === 'active'

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">{plan.displayName}</h1>
        <PlanStatusBadge status={plan.status} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setTab('info')}>Información</Button>
          <Button type="button" variant="outline" onClick={() => setTab('capabilities')}>Capacidades</Button>
          <Button type="button" variant="outline" onClick={() => setTab('limits')}>Límites</Button>
          <Button type="button" variant="outline" onClick={() => setTab('tenants')}>Asignaciones de organizaciones</Button>
        </div>
      </header>

      {tab === 'info' ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6">
          <p>{plan.description}</p>
        </section>
      ) : null}

      {tab === 'capabilities' ? (
        <section className="space-y-2 rounded-3xl border border-border bg-card/70 p-6">
          {Object.entries(plan.capabilities ?? {}).map(([key, enabled]) => (
            <div key={key} className="flex items-center justify-between">
              <span>{key}</span>
              <PlanCapabilityBadge enabled={Boolean(enabled)} label={key} />
            </div>
          ))}
        </section>
      ) : null}

      {tab === 'limits' ? (
        <section className="space-y-4 rounded-3xl border border-border bg-card/70 p-6">
          {limitFeedback ? (
            <Alert
              variant={limitFeedback.kind === 'error' ? 'destructive' : 'success'}
              role={limitFeedback.kind === 'error' ? 'alert' : 'status'}
              aria-live={limitFeedback.kind === 'error' ? 'assertive' : 'polite'}
              className="rounded-sm text-foreground"
            >
              <AlertTitle>{limitFeedback.title}</AlertTitle>
              <AlertDescription>{limitFeedback.message}</AlertDescription>
            </Alert>
          ) : null}
          <PlanLimitsTable
            dimensions={profile}
            editable={limitEditingEnabled}
            busyDimensionKey={busyDimensionKey}
            onUpdate={handleLimitUpdate}
            onRemove={handleLimitReset}
          />
        </section>
      ) : null}

      {tab === 'tenants' ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6">
          La lista de organizaciones asignadas está disponible desde la página de plan de la organización.
        </section>
      ) : null}
    </main>
  )
}
