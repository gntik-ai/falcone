import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Link, Text, Toaster, type ButtonProps } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, TableSkeleton, DataTable, type DataTableColumn } from '@gntik-ai/blocks'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-auth-page.json'
import en from '../../locales/en/pages.console-auth-page.json'
import { failureOf, isRetryable, type Failure } from './api'

i18n.addResourceBundle('es', 'pages.console-auth-page', es)
i18n.addResourceBundle('en', 'pages.console-auth-page', en)

export const NAMESPACE = 'pages.console-auth-page'
export const useCopy = () => useTranslation(NAMESPACE)
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export function Action({ children, ...props }: ButtonProps) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Empty({ title, description = null, testId }: { title: string; description?: string | null; testId?: string }) {
  return <div data-testid={testId} className="min-w-0"><EmptyState icon={undefined} title={title} description={description} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} className="min-w-0" /></div>
}
export function Loading({ label, columns = 4 }: { label: string; columns?: number }) {
  return <section role="status" aria-label={label} aria-busy={true} className="min-w-0"><TableSkeleton rows={3} columns={columns} label={label} className="min-w-0" /></section>
}
export function Callout({ message, tone = 'destructive' }: { message: string; tone?: 'destructive' | 'warning' | 'success' }) {
  return <div role={tone === 'success' ? 'status' : 'alert'} className="min-w-0"><InlineCallout tone={tone} title={message} description={null} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: message, description: '', upgrade: '', viewUsage: '' }} className="min-w-0" /></div>
}

// Localized by status only: the backend message is never shown.
export function useFailureText() {
  const { t } = useCopy()
  return useCallback((failure: Failure, fallback: string) => {
    const { status } = failure
    if (status === 401) return t('errors.session')
    if (status === 403) return t('errors.noAccess')
    if (status === 404) return t('errors.notFound')
    if (status === 409) return t('errors.conflict')
    if (status === 429) return t('errors.rateLimited')
    if (status !== undefined && status >= 500) return t('errors.unavailable')
    return fallback
  }, [t])
}

interface SectionFailureProps {
  kind: 'realm' | 'applications'
  section: string
  testId: string
  failure: Failure
  onRetry: () => void
  backHref: string
}
// 403 and 404 replace only the failed section; every other failure keeps the status code and request id.
// Realm sections offer Reintentar for transient errors only; applications always do (legacy parity).
export function SectionFailure({ kind, section, testId, failure, onRetry, backHref }: SectionFailureProps) {
  const { t } = useCopy()
  const text = useFailureText()
  const title = t(kind === 'realm' ? 'failure.realmTitle' : 'failure.applicationsTitle', { section })
  if (failure.status === 403) {
    return <div data-testid={testId} className="min-w-0"><NoAccessEmpty resource={section} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0"
      labels={{ title: () => t('errors.noAccess'), description: () => t('failure.noAccessHelp', { section }), request: '', requested: '', sent: '' }} /></div>
  }
  if (failure.status === 404) {
    return <div data-testid={testId} className="min-w-0"><NotFoundEmpty icon={undefined} title={t('errors.notFound')} description={t(kind === 'realm' ? 'failure.realmNotFound' : 'failure.workspaceNotFound')}
      action={<Link href={backHref} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t(kind === 'realm' ? 'failure.backOverview' : 'failure.backWorkspaces')}</Link>} titleAs="h3" bordered={false} className="min-w-0" /></div>
  }
  const retryable = kind === 'applications' || isRetryable(failure)
  const message = `${t(kind === 'realm' ? 'failure.realmMessage' : 'failure.applicationsMessage', { section })} ${text(failure, t(kind === 'realm' ? 'failure.realmFallback' : 'failure.applicationsFallback', { section }))}`
  return <div data-testid={testId} className="min-w-0 space-y-3">
    <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true}
      retryLabel={t('failure.retry')} retrying={false} onRetry={retryable ? onRetry : undefined} className="min-w-0"
      labels={{ title, message, support: t('failure.support'), retry: t('failure.retry'), retrying: t('failure.retrying'), retryingStatus: t('failure.retrying'), requestId: t('failure.requestId'), copyRequestId: t('failure.copyRequestId'), copied: t('failure.copied'), requestIdCopied: t('failure.requestIdCopied'), details: t('failure.details') }} />
    {!retryable && <Text as="p" variant="body" tone="muted">{t('failure.noRetry')}</Text>}
  </div>
}

export function Grid<T extends object>({ rows, columns, id, label, empty }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string; empty: string }) {
  return <DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
    showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0 auth-table" labels={{ scrollRegion: label, emptyTitle: empty, emptyDescription: '', loading: () => label }} />
}

// `current` is the result for this revision, or null while it loads. `last` is the newest settled result of any
// revision, so a caller can keep an open form mounted across a reload without showing old data as fresh.
export function useLoadState<T>(load: (signal: AbortSignal) => Promise<T>, revision: number) {
  const [state, setState] = useState<{ revision: number; data?: T; failure?: Failure } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    // Waiting one microtask lets StrictMode's effect replay settle, so one request is sent.
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const data = await load(controller.signal); if (active) setState({ revision, data }) }
      catch (cause) { if (active) setState({ revision, failure: failureOf(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [load, revision])
  return { current: state?.revision === revision ? state : null, last: state }
}
export const useLoad = <T,>(load: (signal: AbortSignal) => Promise<T>, revision: number) => useLoadState(load, revision).current

// Kit 0.11.0 exposes closeLabel but no viewport label prop.
export function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
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
