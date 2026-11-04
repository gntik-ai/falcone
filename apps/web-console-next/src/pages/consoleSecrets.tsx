import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, EmptyState, I18nProvider, Link, LiveAnnouncer, Page, Text, Timestamp, ToastProvider, Toaster } from '@gntik-ai/ui'
import { DataTable, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import i18n from '../i18n'
import es from '../locales/es/pages.console-secrets-page.json'
import en from '../locales/en/pages.console-secrets-page.json'
import { useSession } from '../shell/session'
import { boundTenant, canRevoke, failureOf, loadInventory, rotationHref, type Failure, type SecretRow } from './consoleSecrets/api'
import { FailureState, focusRing } from './consoleSecrets/States'
import { RevokeDialog } from './consoleSecrets/RevokeDialog'
import './consoleSecrets/page.css'

i18n.addResourceBundle('es', 'pages.console-secrets-page', es)
i18n.addResourceBundle('en', 'pages.console-secrets-page', en)

export function SecretVersionBadge({ state }: { state: 'active' | 'grace' }) {
  const { t } = useTranslation('pages.console-secrets-page')
  return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel=""><Text as="span" variant="supporting" tone={state === 'grace' ? 'warning' : 'default'}>{t(`states.${state}`)}</Text></Badge>
}
function InventoryContent() {
  const { t, i18n: language } = useTranslation('pages.console-secrets-page')
  const session = useSession()
  const tenant = boundTenant(session)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ tenant: string | null; attempt: number; rows?: SecretRow[]; failure?: Failure } | null>(null)
  const [dialog, setDialog] = useState<{ row: SecretRow; trigger: HTMLElement } | null>(null)
  const inventory = useRef<HTMLDivElement>(null)
  const focusAfterRetry = useRef(false)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    // Avoid starting duplicate GETs during StrictMode's effect replay.
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const rows = await loadInventory(tenant, controller.signal); if (active) setResult({ tenant, attempt, rows }) }
      catch (cause) { if (active) setResult({ tenant, attempt, failure: failureOf(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [tenant, attempt])
  const current = result?.tenant === tenant && result.attempt === attempt ? result : null
  const rows = current?.rows, failure = current?.failure
  useLayoutEffect(() => {
    if (!current || !focusAfterRetry.current) return
    focusAfterRetry.current = false
    // The loading skeleton removes the retry trigger; restore its keyboard position.
    const retry = failure && Array.from(inventory.current?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))
    const target = retry || inventory.current
    target?.focus()
  }, [current, failure, t])
  const columns: DataTableColumn<SecretRow>[] = [
    { id: 'name', header: t('name'), sortable: false, cell: (row) => <Text variant="body" tone="default" className="wrap-anywhere">{row.name}</Text> },
    { id: 'domain', header: t('domain'), sortable: false, cell: (row) => t(`domains.${row.domain}`) },
    { id: 'tenant', header: t('organization'), sortable: false, cell: (row) => row.tenantId ?? t('missing') },
    { id: 'state', header: t('versionState'), sortable: false, cell: (row) => row.currentVersion ? <SecretVersionBadge state={row.currentVersion.state} /> : t('noActiveVersion') },
    { id: 'rotation', header: t('lastRotation'), sortable: false, cell: (row) => row.currentVersion ? <Timestamp value={row.currentVersion.activatedAt} locale={language.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('missing')} /> : t('missing') },
    { id: 'actions', header: t('actions'), sortable: false, cell: (row) => {
      const enabled = canRevoke(row, session)
      return <div className="space-y-2"><div className="flex flex-wrap items-center gap-2">
        <Link href={rotationHref(row)} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('rotateNamed', { name: row.name })} className={focusRing}>{t('rotate')}</Link>
        <Link href={rotationHref(row)} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('historyNamed', { name: row.name })} className={focusRing}>{t('history')}</Link>
        <Button type="button" variant="destructive" size="sm" loading={false} disabled={!enabled} iconOnly={false} icon={undefined} trailingIcon={undefined} aria-label={t('revokeNamed', { name: row.name })} className={focusRing} onClick={(event) => { if (enabled) setDialog({ row, trigger: event.currentTarget }) }}>{t('revoke')}</Button>
      </div>{!enabled && <Text as="p" variant="supporting" tone="muted">{t(row.currentVersion ? 'unbound' : 'noActiveVersion')}</Text>}</div>
    } },
  ]
  return <>
    {rows && <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('table')} searchPlaceholder={t('table')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('table')} className="secrets-toolbar min-w-0"
      filters={<div className="min-w-0 space-y-2"><Text as="p" variant="body" tone="default">{t('count', { count: rows.length })}</Text><Text as="p" variant="supporting" tone="muted">{t('returnedRows')}</Text></div>} />}
    <div ref={inventory} role="region" aria-label={t('table')} tabIndex={-1} className={`min-w-0 ${focusRing}`}>
      {failure ? <FailureState failure={failure} retry={() => { focusAfterRetry.current = true; setAttempt((value) => value + 1) }} />
        : !rows ? <section role="status" aria-label={t('loading')} aria-busy={true}><TableSkeleton rows={3} columns={6} label={t('loading')} className="min-w-0" /></section>
        : !rows.length ? <EmptyState icon={undefined} title={t('empty')} description={t('emptyDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
        : <DataTable rows={rows} columns={columns} getRowId={(row) => row.path} getRowLabel={(row) => row.name} caption={t('table')} showCaption={false} paginated={false}
            selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
            showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="secrets-table min-w-0"
            labels={{ scrollRegion: t('table'), emptyTitle: t('empty'), emptyDescription: t('emptyDescription'), loading: () => t('loading') }} />}
    </div>
    {dialog && <RevokeDialog row={dialog.row} trigger={dialog.trigger} onClose={() => setDialog(null)} />}
  </>
}
function LocalizedToaster() {
  const { t } = useTranslation('pages.console-secrets-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 exposes closeLabel but no viewport label prop.
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
export default function ConsoleSecretsPage() {
  const { t, i18n: language } = useTranslation('pages.console-secrets-page')
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel') }}><LiveAnnouncer><ToastProvider timeout={5000} limit={1} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-4 wrap-anywhere" data-testid="console-secrets-page"
      header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
      <InventoryContent />
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
