import { useEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, CodeBlock, EmptyState, I18nProvider, Link, LinkProvider, Page, Tabs, TabsList, TabsPanel, TabsTab, Text } from '@gntik-ai/ui'
import { DescriptionListCard, ErrorPanel, FirstRunEmpty, NoAccessEmpty, PageHeader, PageSkeleton } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { useCapabilityGate } from '../shell/capabilities'
import { getWorkspaceRealtime, type WorkspaceRealtimeResponse } from './consoleRealtime/api'
import i18n from '../i18n'
import es from '../locales/es/pages.console-realtime-page.json'
import en from '../locales/en/pages.console-realtime-page.json'

i18n.addResourceBundle('es', 'pages.console-realtime-page', es)
i18n.addResourceBundle('en', 'pages.console-realtime-page', en)
const languages = ['javascript', 'nodejs', 'python'] as const
type Language = typeof languages[number]
const storageKey = 'realtime-snippet-lang'
function initialLanguage(): Language {
  try { const value = sessionStorage.getItem(storageKey); return languages.includes(value as Language) ? value as Language : 'javascript' }
  catch { return 'javascript' }
}
export function mapChannelTypes(sources: WorkspaceRealtimeResponse['dataSources']) {
  return Array.from(new Set((sources ?? []).flatMap((source) => source?.type === 'postgresql' ? ['postgresql-changes'] : source?.type === 'mongodb' ? ['mongodb-changes'] : [])))
}

function ProvisioningLink({ href, ...props }: ComponentPropsWithRef<'a'>) {
  return <RouterLink to={href ?? ''} {...props} />
}

function Realtime() {
  const { t } = useTranslation('pages.console-realtime-page')
  const { workspaceId: routeId } = useParams<{ workspaceId: string }>()
  const { activeWorkspaceId } = useConsoleContext()
  const workspaceId = routeId ?? activeWorkspaceId ?? ''
  const gate = useCapabilityGate('realtime')
  const [result, setResult] = useState<{ workspace: string; data: WorkspaceRealtimeResponse | null; error: Partial<ApiError> | null } | null>(null)
  const [busy, setBusy] = useState(true)
  const [reload, setReload] = useState(0)
  const [language, setLanguage] = useState<Language>(initialLanguage)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [manualId, setManualId] = useState<string | null>(null)
  const request = useRef<{ workspace: string; reload: number; promise: ReturnType<typeof getWorkspaceRealtime> } | null>(null)
  const recovery = useRef(false)
  const container = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const data = result?.workspace === workspaceId ? result.data : null
  const error = result?.workspace === workspaceId ? result.error : null
  useEffect(() => {
    let cancelled = false
    setCopiedId(null); setManualId(null)
    if (!workspaceId) { setBusy(false); return }
    setBusy(true)
    if (request.current?.workspace !== workspaceId || request.current.reload !== reload) {
      request.current = { workspace: workspaceId, reload, promise: getWorkspaceRealtime(workspaceId) }
    }
    void request.current.promise.then((data) => {
      if (!cancelled) setResult({ workspace: workspaceId, data, error: null })
    }).catch((error: Partial<ApiError>) => {
      if (!cancelled) setResult({ workspace: workspaceId, data: null, error })
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [workspaceId, reload])
  useEffect(() => {
    document.title = t('documentTitle')
    return () => { document.title = t('consoleTitle') }
  }, [t])
  useEffect(() => {
    if (!busy && !gate.loading && recovery.current) {
      recovery.current = false
      if (error) Array.from(container.current?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))?.focus()
      else heading.current?.focus()
    }
  }, [busy, gate.loading, error, t])
  useEffect(() => {
    if (!copiedId) return
    const timer = window.setTimeout(() => setCopiedId(null), 2500)
    return () => window.clearTimeout(timer)
  }, [copiedId])
  // Shared session transport and shell own refresh and redirect.
  if (error?.status === 401) return null
  const channels = mapChannelTypes(data?.dataSources)
  const retry = () => { recovery.current = true; setReload((value) => value + 1) }
  const copy = async (id: string, value: string) => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') { setManualId(id); return }
      await navigator.clipboard.writeText(value)
      setManualId(null); setCopiedId(id)
    } catch { setManualId(id) }
  }
  const skeleton = <div role="status" aria-label={t('loading')} aria-busy="true"><PageSkeleton stats={0} rows={4} label={t('loading')} className="" /></div>
  const header = <PageHeader as="div" titleRef={heading} wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: t('description'), moreActions: t('snippets'), sections: t('snippets') }} />
  const back = <Link href="/console/workspaces" underline="always">{t('back')}</Link>
  const body = <>
    <DescriptionListCard title={t('configuration')} description="" titleAs="h2" wrap={true} columns={1} onEdit={undefined} onCopy={undefined} editLabel={t('edit')}
      labels={{ title: t('configuration'), description: '', edit: t('edit'), copy: () => t('copy'), copied: () => t('copied'), copiedToClipboard: t('copiedEndpoint') }}
      items={[
        { id: 'workspace', label: t('fields.workspace'), value: data?.workspaceId ?? '', mono: true, render: undefined, status: undefined, copyable: false, copyValue: '' },
        { id: 'endpoint', label: t('fields.endpoint'), value: data?.realtimeEndpointUrl ?? t('unavailable'), mono: true, status: undefined, copyable: false, copyValue: '',
          render: <div className="min-w-0 space-y-2"><Text as="span" className="block font-mono wrap-anywhere">{data?.realtimeEndpointUrl ?? t('unavailable')}</Text>{data?.realtimeEndpointUrl ? <Button type="button" variant="secondary" disabled={!gate.enabled} loading={false} onClick={() => void copy('endpoint', data.realtimeEndpointUrl!)}>{t(copiedId === 'endpoint' ? 'copied' : 'copyEndpoint')}</Button> : null}</div> },
        { id: 'enabled', label: t('fields.enabled'), value: t(data?.features?.realtime === true ? 'enabled' : 'disabled'), mono: false, render: undefined, status: undefined, copyable: false, copyValue: '' },
        { id: 'channels', label: t('fields.channels'), value: channels.join(', '), mono: false, render: undefined, status: undefined, copyable: false, copyValue: '' },
      ]} />
    {!data?.features?.realtime || !channels.length ? <LinkProvider component={ProvisioningLink}><FirstRunEmpty title={t('emptyTitle')} description={t('emptyDescription')} titleAs="h2" bordered={false} icon={undefined}
      actionLabel="" onAction={undefined} secondary={{ label: t('provisioning'), href: `/console/workspaces/${workspaceId}/provisioning` }} steps={[]}
      labels={{ title: t('emptyTitle'), description: t('emptyDescription'), action: '', guide: t('provisioning') }} /></LinkProvider>
      : <section aria-labelledby="realtime-snippets-heading" className="min-w-0 space-y-4">
        <h2 id="realtime-snippets-heading" className="text-lg font-semibold">{t('snippets')}</h2>
        <Tabs value={language} onValueChange={(value) => { setLanguage(value as Language); setCopiedId(null); setManualId(null); try { sessionStorage.setItem(storageKey, String(value)) } catch { /* Storage can be unavailable. */ } }}>
          <TabsList aria-label={t('languages')} className="max-w-full overflow-x-auto">{languages.map((language) => <TabsTab key={language} value={language} disabled={!gate.enabled}>{t(language)}</TabsTab>)}</TabsList>
          {languages.map((language) => <TabsPanel key={language} value={language} tabIndex={-1} className="min-w-0 space-y-4">
            <h3 className="text-lg font-semibold">{t('connection')}</h3><Text>{t('connectionDescription')}</Text>
            {Object.keys(es.entries).filter((id) => id.startsWith(language === 'javascript' ? 'realtime-js-' : `realtime-${language}-`)).map((id) => {
              const code = t(`entries.${id}.code`).replace(/\{REALTIME_ENDPOINT\}|\{WORKSPACE_ID\}|\{CHANNEL_TYPE\}/g, (token) => token === '{REALTIME_ENDPOINT}' ? data?.realtimeEndpointUrl ?? '<REALTIME_ENDPOINT>' : token === '{WORKSPACE_ID}' ? workspaceId : channels[0])
              return <section key={id} className="min-w-0 space-y-2" aria-label={t(`entries.${id}.label`)}>
                <h4 className="font-medium">{t(`entries.${id}.label`)}</h4>
                <Button type="button" variant="secondary" disabled={!gate.enabled} loading={false} onClick={() => void copy(id, code)}>{t(copiedId === id ? 'copied' : 'copy')}</Button>
                <CodeBlock code={code} language={language === 'python' ? 'python' : 'javascript'} filename="" label={t(`entries.${id}.label`)} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined} className="min-w-0 max-w-full" />
                {!data?.realtimeEndpointUrl && <Text>{t('missingEndpoint')}</Text>}
                <Text>{t('secrets')} {t(`entries.${id}.secret`)}</Text>
              </section>
            })}
          </TabsPanel>)}
        </Tabs>
        {channels.length > 1 && <Text>{t('additional', { channels: channels.slice(1).join(', ') })}</Text>}
      </section>}
    <Text role="status" aria-live="polite">{manualId ? t('manual') : copiedId ? t(copiedId === 'endpoint' ? 'copiedEndpoint' : 'copiedSnippet') : ''}</Text>
  </>
  return <div ref={container} className="console-realtime min-w-0 wrap-anywhere">
    <Page width="default" header={header} actions={null} actionBar={null} className="min-w-0">
      {!workspaceId ? <EmptyState title={t('workspaceRequired')} description="" titleAs="h2" bordered={false} primaryAction={null} secondaryAction={null} />
        : error?.status === 403 ? <NoAccessEmpty resource={t('fields.workspace')} owner="" showRequestAccess={false} onRequestAccess={undefined} defaultRequested={false} action={{ label: t('back'), href: '/console/workspaces' }} titleAs="h2" bordered={false}
          labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
        : error?.status === 404 ? <EmptyState title={t('notFound')} description={t('notFoundDescription')} titleAs="h2" bordered={false} primaryAction={back} secondaryAction={null} />
        : error ? <ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={busy} onRetry={retry}
          labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
        : busy || !data || gate.loading ? skeleton
        : <>{!gate.enabled && <div className="space-y-2"><Badge tone="neutral">{t('upgradeBadge')}</Badge><Text>{t('upgrade')}</Text></div>}<div inert={!gate.enabled} data-testid={gate.enabled ? 'realtime-enabled' : 'realtime-restricted'} className={gate.enabled ? 'min-w-0 space-y-6' : 'min-w-0 space-y-6 opacity-50'}>{body}</div></>}
    </Page>
  </div>
}
export default function ConsoleRealtimePage() {
  const { i18n } = useTranslation('pages.console-realtime-page')
  return <I18nProvider locale={i18n.language}><Realtime /></I18nProvider>
}
