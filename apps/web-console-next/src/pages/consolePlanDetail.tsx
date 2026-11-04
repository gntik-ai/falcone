import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Page, Stepper, Tabs, TabsList, TabsPanel, TabsTab, Text, ToastProvider, useAnnounce, useToast } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, ListSkeleton, NoAccessEmpty, NotFoundEmpty, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import i18n from '../i18n'
import es from '../locales/es/pages.console-plan-detail-page.json'
import en from '../locales/en/pages.console-plan-detail-page.json'
import { ConfirmDialog } from './consolePlanDetail/ConfirmDialog'
import { MutationFeedback } from './consolePlanDetail/Feedback'
import { LimitsTable, type RowOutcome } from './consolePlanDetail/LimitsTable'
import { AssignmentsPanel, CapabilitiesPanel, InfoPanel, usePlanStatuses } from './consolePlanDetail/Panels'
import { LocalizedToaster } from './consolePlanDetail/Toasts'
import { deletePlan, failureFrom, getLimits, getPlan, removeLimit, setLimit, transitionPlan, type Failure, type LimitRow, type PlanRecord } from './consolePlanDetail/api'
import { isDialogAction, isLifecycle, lifecycleActionFor, lifecycleOrder, retryable, targetOf, validateLimit, type Action, type DialogKind } from './consolePlanDetail/model'

const NAMESPACE = 'pages.console-plan-detail-page'
i18n.addResourceBundle('es', NAMESPACE, es)
i18n.addResourceBundle('en', NAMESPACE, en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
type Load = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; failure: Failure }
type Tab = 'info' | 'capabilities' | 'limits' | 'assignments'
interface DialogState { id: number; kind: DialogKind; action: Action; open: boolean; label: string }
const bump = (record: Record<string, number | undefined>, key: string) => ({ ...record, [key]: (record[key] ?? 0) + 1 })
const without = <T,>(record: Record<string, T>, key: string) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))

function useNarrow() {
  const query = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches))
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

function PlanDetail({ routeId }: { routeId: string }) {
  const { t, i18n: language } = useTranslation(NAMESPACE)
  const navigate = useNavigate()
  const announce = useAnnounce()
  const toast = useToast()
  const statuses = usePlanStatuses()
  const narrow = useNarrow()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [reloading, setReloading] = useState(false)
  const [plan, setPlan] = useState<PlanRecord | null>(null)
  const [rows, setRows] = useState<LimitRow[]>([])
  const [tab, setTab] = useState<Tab>('info')
  const [drafts, setDrafts] = useState<Record<string, number | null>>({})
  const [versions, setVersions] = useState<Record<string, number | undefined>>({})
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome | undefined>>({})
  const [busy, setBusy] = useState<Action | null>(null)
  const [feedback, setFeedback] = useState<{ action: Action; failure: Failure } | null>(null)
  // A lifecycle request whose outcome is unknown. Unrelated feedback changes never clear it: only a successful or rejected
  // retry, or closing the dialog that held it, resolves it.
  const [unresolved, setUnresolved] = useState<{ action: Action; failure: Failure } | null>(null)
  const [saved, setSaved] = useState<{ title: string; message: string } | null>(null)
  const [denied, setDenied] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const dialogCount = useRef(0)
  const recovering = useRef(false)
  const refocusHeading = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const lifecycleButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const feedbackBox = useRef<HTMLDivElement>(null)
  const loadErrorBox = useRef<HTMLDivElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // Both reads are load-bearing together, as in the legacy page: either failure replaces the whole detail.
  useEffect(() => {
    let cancelled = false
    // Start after the effect replay of StrictMode has settled, so one load sends one pair of reads.
    const timer = setTimeout(() => {
      Promise.all([getPlan(routeId), getLimits(routeId)]).then(([record, limits]) => {
        if (cancelled) return
        setPlan(record); setRows(limits.profile ?? []); setLoad({ phase: 'ready' }); setReloading(false)
      }, (cause: unknown) => {
        if (cancelled) return
        setPlan(null); setRows([]); setLoad({ phase: 'error', failure: failureFrom(cause) }); setReloading(false)
      })
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [routeId, attempt])
  useEffect(() => {
    if (load.phase === 'ready' && recovering.current) { recovering.current = false; heading.current?.focus() }
  }, [load.phase])
  useEffect(() => {
    if (load.phase === 'error' && load.failure.status !== 401) loadErrorBox.current?.focus()
  }, [load])
  useEffect(() => {
    if (feedback && feedback.failure.status !== 401) feedbackBox.current?.focus()
  }, [feedback])

  const locked = denied || busy !== null
  const shown = feedback ?? unresolved
  // A failed or lost lifecycle response leaves the outcome unresolved: only Reintentar may send that transition again.
  const lifecycleUnresolved = unresolved !== null
  const count = typeof plan?.assignedTenantCount === 'number' ? plan.assignedTenantCount : null
  const assignedSummary = count === null ? t('assignedUnknown') : t('assignedSummary', { count })
  const affected = count === null ? t('limits.affectedUnknown') : t('limits.affected', { count })

  function focusHeadingSoon() { setTimeout(() => heading.current?.focus(), 0) }

  async function perform(current: PlanRecord, action: Action) {
    if (isLifecycle(action)) {
      const target = targetOf[action.kind]
      const response = await transitionPlan(current.id, target)
      const accepted = response?.newStatus ?? target
      if (!mounted.current) return
      setPlan((value) => value && { ...value, status: accepted, updatedAt: response?.transitionedAt ?? value.updatedAt })
      // The transition is accepted: a failed reload keeps the accepted status instead of reporting a failure.
      try {
        const fresh = await getPlan(current.id)
        if (mounted.current) setPlan(fresh)
      } catch { /* The accepted status stays. */ }
      if (!mounted.current) return
      const message = t('success.lifecycle', { name: current.displayName, status: accepted })
      toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' })
      announce(message, 'polite')
      refocusHeading.current = true
      setFeedback(null); setUnresolved(null)
      setDialog((value) => value && { ...value, open: false })
      focusHeadingSoon()
    } else if (action.kind === 'delete') {
      await deletePlan(current.id)
      if (!mounted.current) return
      announce(t('success.deleted', { name: current.displayName }), 'polite')
      navigate('/console/plans', { state: { focusMainHeading: true } })
    } else {
      const reset = action.kind === 'reset'
      const response = reset ? await removeLimit(current.id, action.key) : await setLimit(current.id, action.key, action.value)
      if (!mounted.current) return
      const accepted = reset ? (response as { effectiveValue?: number }).effectiveValue : (response as { newValue?: number }).newValue ?? action.value
      const source = (response as { source?: LimitRow['source'] }).source ?? (reset ? 'default' : 'explicit')
      setRows((value) => value.map((row) => row.dimensionKey === action.key ? { ...row, effectiveValue: typeof accepted === 'number' ? accepted : row.effectiveValue, source } : row))
      setDrafts((value) => without(value, action.key))
      setVersions((value) => bump(value, action.key))
      setOutcomes((value) => ({ ...value, [action.key]: reset ? 'reset' : 'saved' }))
      // The accepted value stays if the reconciling read fails.
      try {
        const fresh = await getLimits(current.id)
        if (mounted.current) setRows(fresh.profile ?? [])
      } catch { /* The accepted value stays. */ }
      if (!mounted.current) return
      setFeedback(null)
      setSaved({ title: t(reset ? 'limits.resetTitle' : 'limits.savedTitle'), message: t(reset ? 'limits.resetDone' : 'limits.saved', { key: action.key }) })
      announce(t(reset ? 'limits.resetDone' : 'limits.saved', { key: action.key }), 'polite')
      setDialog((value) => value && { ...value, open: false })
      // Focus stays on the row action that started the change.
      setTimeout(() => document.querySelector<HTMLElement>(reset ? `[data-reset-key="${action.key.replace(/["\\]/g, '')}"]` : `[data-save-key="${action.key.replace(/["\\]/g, '')}"]`)?.focus(), 0)
    }
  }

  // One request per user action. A retry sends the identical action again and nothing sends it on its own.
  async function run(action: Action, retry = false) {
    if (inFlight.current || !plan || denied) return
    if (!retry && isLifecycle(action) && lifecycleUnresolved) return
    inFlight.current = true
    setBusy(action)
    setSaved(null)
    if (!retry) setFeedback(null)
    try {
      await perform(plan, action)
    } catch (cause) {
      if (!mounted.current) return
      const failure = failureFrom(cause)
      if (failure.status === 403) setDenied(true)
      // A lost lifecycle response may have been applied: the re-sent request can be rejected as an invalid transition, so
      // a failed retry or a rejected transition reloads the plan alone and the header never keeps a stale status.
      if (isLifecycle(action) && (retry ? failure.status !== 401 && failure.status !== 403 : failure.code === 'INVALID_TRANSITION')) {
        try {
          const fresh = await getPlan(plan.id)
          if (mounted.current) setPlan(fresh)
        } catch { /* The loaded plan stays. */ }
        if (!mounted.current) return
      }
      if (action.kind === 'set' || action.kind === 'reset') {
        // The row returns to the persisted profile before it reports the failure, as the legacy reconciliation read does.
        if (failure.status !== 401) {
          try {
            const fresh = await getLimits(plan.id)
            if (mounted.current) setRows(fresh.profile ?? [])
          } catch { /* The loaded profile stays. */ }
          if (!mounted.current) return
        }
        setDrafts((value) => without(value, action.key))
        setVersions((value) => bump(value, action.key))
        setOutcomes((value) => ({ ...value, [action.key]: action.kind === 'set' ? 'failed' : 'resetFailed' }))
      }
      setFeedback({ action, failure })
      if (isLifecycle(action)) setUnresolved(retryable(failure) ? { action, failure } : null)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(null)
    }
  }

  function openDialog(kind: DialogKind, action: Action, label = '') {
    if (locked || !plan) return
    setFeedback(null); setSaved(null)
    refocusHeading.current = false
    dialogCount.current += 1
    setDialog({ id: dialogCount.current, kind, action, open: true, label })
  }
  function closeDialog() {
    if (inFlight.current) return
    setDialog((value) => value && { ...value, open: false })
    setFeedback((value) => value && isDialogAction(value.action) ? null : value)
    // Closing the dialog discards its retry: the confirmation is needed again.
    setUnresolved((value) => value && isDialogAction(value.action) ? null : value)
  }
  function save(key: string) {
    const row = rows.find((value) => value.dimensionKey === key)
    const validation = validateLimit(key in drafts ? drafts[key] : row?.effectiveValue ?? null)
    if (!row || locked || !validation.valid || validation.value === row.effectiveValue) return
    void run({ kind: 'set', key, value: validation.value })
  }
  function finalFocus() {
    if (!dialog) return null
    if (dialog.kind === 'reset') return Array.from(document.querySelectorAll<HTMLElement>('[data-reset-key]')).find((node) => node.getAttribute('data-reset-key') === (dialog.action as { key: string }).key) ?? null
    if (refocusHeading.current) return heading.current
    return dialog.kind === 'delete' ? deleteButton.current : lifecycleButton.current
  }

  const back = <RouterLink to="/console/plans" state={{ focusMainHeading: true }} className={`underline ${focus}`}>{t('back')}</RouterLink>
  const loadingNow = load.phase === 'loading' || (load.phase === 'error' && load.failure.status === 401 && !reloading)
  // While loading, the header is a skeleton too; the labelled status in the body announces the load once.
  const header = loadingNow ? <div aria-hidden={true} data-testid="header-skeleton" className="min-w-0"><ListSkeleton rows={1} label={t('load.loading')} className="min-w-0" /></div> : <PageHeader as="div" wrapTitle={true} titleRef={heading} title={plan?.displayName ?? t('pageTitle')} description={t('description')} breadcrumbs={null}
    status={plan?.status ?? ''} statuses={statuses} meta={plan ? [{ label: t('slug'), value: plan.slug, mono: true }] : []} actions={[]} tabs={null}
    labels={{ title: plan?.displayName ?? t('pageTitle'), description: t('description'), moreActions: t('actions'), sections: t('tabs.label') }} />

  let body: JSX.Element
  if (loadingNow) {
    body = <section role="status" aria-label={t('load.loading')} aria-busy={true}>
      <Text>{t('load.loadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={4} columns={5} label={t('load.loading')} className="min-w-0" /></div>
    </section>
  } else if (load.phase === 'error') {
    const failure = load.failure
    body = <div ref={loadErrorBox} tabIndex={-1} data-testid="load-error" className={`min-w-0 ${focus}`}>
      {failure.status === 403
        ? <div role="alert" className="min-w-0"><NoAccessEmpty resource={t('pageTitle')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
          labels={{ title: () => t('load.noAccessTitle'), description: () => t('load.noAccessDescription'), request: '', requested: '', sent: '' }} /></div>
        : failure.status === 404
          ? <div role="alert" className="min-w-0"><NotFoundEmpty icon={undefined} title={t('load.notFoundTitle')} description={t('load.notFoundDescription')} action={back} titleAs="h2" bordered={false} /></div>
          : <ErrorPanel title={t('load.errorTitle')} message={t(failure.status ? 'load.errorMessage' : 'load.networkMessage')} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true}
            onRetry={() => { recovering.current = true; setReloading(true); setAttempt((value) => value + 1) }} retrying={reloading} retryLabel={t('retry')}
            labels={{ title: t('load.errorTitle'), message: t(failure.status ? 'load.errorMessage' : 'load.networkMessage'), support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
    </div>
  } else if (plan) {
    const lifecycle = lifecycleActionFor(plan.status)
    const editable = plan.status === 'draft' || plan.status === 'active'
    const activeBusy = busy && isLifecycle(busy) ? busy.kind : null
    const current = lifecycleOrder.indexOf(plan.status)
    const guidance = lifecycle ? t(`lifecycle.guidance.${lifecycle}`) : t(plan.status === 'archived' ? 'lifecycle.guidance.archived' : 'lifecycle.guidance.none')
    const stateLabel = (value: string) => t(`status.${value}`)
    const calloutTitle = plan.status === 'draft' ? 'limits.calloutDraftTitle' : plan.status === 'active' ? (count === 0 ? 'limits.calloutActiveEmptyTitle' : 'limits.calloutActiveTitle') : 'limits.calloutReadOnlyTitle'
    const calloutBody = plan.status === 'draft' ? t('limits.calloutDraft') : plan.status === 'active' ? t('limits.calloutActive', { affected }) : t('limits.calloutReadOnly', { status: plan.status })
    // Each failure renders once: Activar and a refused limit save above the tabs, other limit failures under the table.
    const aboveTabs = shown && !isDialogAction(shown.action) && (shown.action.kind === 'activate' || shown.failure.status === 403) ? shown : null
    const shownFeedback = shown && !isDialogAction(shown.action) && !aboveTabs ? shown : null
    const lifecycleName = lifecycle ? t(`action.${lifecycle}`) : ''
    body = <>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="w-full sm:w-auto">{back}</span>
        {lifecycle && <Button ref={lifecycleButton} type="button" variant={lifecycle === 'activate' ? 'primary' : 'secondary'} className="w-full sm:w-auto" disabled={locked || lifecycleUnresolved} aria-busy={activeBusy === lifecycle}
          aria-describedby="plan-lifecycle-help" aria-label={t(activeBusy === lifecycle ? 'action.busyName' : 'action.name', { action: lifecycleName, name: plan.displayName })}
          onClick={() => lifecycle === 'activate' ? void run({ kind: 'activate' }) : openDialog(lifecycle, { kind: lifecycle })}>
          {activeBusy === lifecycle ? t('action.updating') : lifecycleName}
        </Button>}
        <Button ref={deleteButton} type="button" variant="destructive" className="w-full sm:w-auto" disabled={locked || plan.status === 'active'} aria-busy={busy?.kind === 'delete'}
          aria-describedby="plan-delete-help" aria-label={t(busy?.kind === 'delete' ? 'action.busyName' : 'action.name', { action: t('action.delete'), name: plan.displayName })}
          onClick={() => openDialog('delete', { kind: 'delete' })}>
          {busy?.kind === 'delete' ? t('action.deleting') : t('action.delete')}
        </Button>
      </div>
      <section aria-labelledby="plan-lifecycle-heading" className="min-w-0 space-y-3">
        <h2 id="plan-lifecycle-heading" className="text-sm font-semibold">{t('lifecycle.title')}</h2>
        <Stepper steps={lifecycleOrder.map((value) => ({ id: value, label: stateLabel(value), description: t(`lifecycle.summary.${value}`) }))} current={current}
          orientation={narrow ? 'vertical' : 'horizontal'} onStepClick={undefined} compact={false} label={t('lifecycle.sequence')}
          statusText={{ complete: t('lifecycle.complete'), current: t('lifecycle.current'), upcoming: t('lifecycle.upcoming') }} formatCount={(step, total) => `${step}/${total}`} className="min-w-0" />
        <Text id="plan-lifecycle-help" variant="supporting" tone="muted">{guidance}</Text>
        <Text id="plan-delete-help" variant="supporting" tone="muted">{plan.status === 'active' ? t('deleteHelpActive') : t('deleteHelp')}</Text>
      </section>
      {aboveTabs && <MutationFeedback ref={feedbackBox} action={aboveTabs.action} failure={aboveTabs.failure} busy={busy !== null} onRetry={() => void run(aboveTabs.action, true)} titleAs="h2" />}
      <Tabs value={tab} defaultValue={undefined} variant="underline" orientation="horizontal" onValueChange={(value) => setTab(value as Tab)} className="min-w-0">
        <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('tabs.label')} className="flex max-w-full flex-nowrap overflow-x-auto">
          {(['info', 'capabilities', 'limits', 'assignments'] as const).map((value) => <TabsTab key={value} value={value} className={`shrink-0 ${focus}`}>{t(`tabs.${value}`)}</TabsTab>)}
        </TabsList>
        <TabsPanel value="info" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><InfoPanel plan={plan} count={count} locale={language.language} /></TabsPanel>
        <TabsPanel value="capabilities" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><CapabilitiesPanel plan={plan} /></TabsPanel>
        <TabsPanel value="limits" keepMounted={false} className={`min-w-0 space-y-4 pt-4 ${focus}`}>
          <div className="space-y-1"><h2 className="text-sm font-semibold">{t('limits.title')}</h2>
            <Text variant="supporting" tone="muted">{editable ? t('limits.helpEditable') : t('limits.helpReadOnly', { status: plan.status })}</Text></div>
          <InlineCallout tone={plan.status === 'active' ? 'warning' : 'info'} title={t(calloutTitle)} description={calloutBody} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
            labels={{ title: t(calloutTitle), description: calloutBody, upgrade: '', viewUsage: '' }} />
          {rows.length > 0
            ? <LimitsTable rows={rows} editable={editable} drafts={drafts} versions={versions} outcomes={outcomes} busyKey={busy?.kind === 'set' || busy?.kind === 'reset' ? { key: busy.key, reset: busy.kind === 'reset' } : null} locked={locked}
              onDraft={(key, value) => { if (locked) return; setDrafts((current) => ({ ...current, [key]: value })); setOutcomes((current) => ({ ...current, [key]: undefined })); setSaved(null) }}
              onRestore={(key) => { setDrafts((current) => without(current, key)); setVersions((current) => bump(current, key)); setTimeout(() => document.getElementById(`limit-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`)?.focus(), 0) }}
              onSave={save} onReset={(row) => openDialog('reset', { kind: 'reset', key: row.dimensionKey }, row.displayLabel)} />
            : <EmptyState title={t('limits.emptyTitle')} description={t('limits.emptyDescription')} titleAs="h3" bordered={true} primaryAction={null} secondaryAction={null} />}
          {shownFeedback && <MutationFeedback ref={feedbackBox} action={shownFeedback.action} failure={shownFeedback.failure} busy={busy !== null} onRetry={() => void run(shownFeedback.action, true)} titleAs="h3" />}
          {saved && !shownFeedback && !aboveTabs && <InlineCallout tone="success" title={saved.title} description={saved.message} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
            labels={{ title: saved.title, description: saved.message, upgrade: '', viewUsage: '' }} />}
        </TabsPanel>
        <TabsPanel value="assignments" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><AssignmentsPanel summary={assignedSummary} /></TabsPanel>
      </Tabs>
      {dialog && <ConfirmDialog key={dialog.id} kind={dialog.kind} open={dialog.open} plan={plan} action={dialog.action} busy={busy !== null} denied={denied}
        failure={shown && isDialogAction(shown.action) ? shown.failure : null}
        description={dialog.kind === 'deprecate' ? t('dialog.deprecateDescription', { name: plan.displayName, impact: t('lifecycle.guidance.deprecate') })
          : dialog.kind === 'archive' ? t('dialog.archiveDescription', { name: plan.displayName, impact: t('lifecycle.guidance.archive') })
            : dialog.kind === 'delete' ? t('dialog.deleteDescription', { name: plan.displayName })
              : t('dialog.resetDescription', { dimension: dialog.label, impact: plan.status === 'active' ? t('dialog.resetImpactActive', { affected }) : t('dialog.resetImpactInactive') })}
        onConfirm={() => void run(dialog.action)} onRetry={() => shown && void run(shown.action, true)} onClose={closeDialog} onClosed={() => setDialog((value) => value?.id === dialog.id ? null : value)} finalFocus={finalFocus} />}
    </>
  } else {
    body = <EmptyState title={t('load.notFoundTitle')} description={t('load.notFoundDescription')} titleAs="h2" bordered={false} primaryAction={null} secondaryAction={null} />
  }

  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} header={header} className="console-plan-detail min-w-0 space-y-6 wrap-anywhere">
    {body}
  </Page>
}

// The app root provides the announcer and the kit locale, so a success announced just before a redirect stays in the
// same live region (the create page announces its success there and then lands on this page).
export default function ConsolePlanDetailPage() {
  const { planId = '' } = useParams()
  return <ToastProvider timeout={5000} limit={1}>
    <PlanDetail key={planId} routeId={planId} /><LocalizedToaster />
  </ToastProvider>
}
