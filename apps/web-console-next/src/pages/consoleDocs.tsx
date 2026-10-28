import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  Button, CodeBlock, EmptyState, I18nProvider, Link, LiveAnnouncer, Page, Tabs, TabsList, TabsTab, TabsPanel,
  Text, Textarea, Timestamp, ToastProvider, Toaster, useAnnounce, useToast,
} from '@gntik-ai/ui'
import {
  DescriptionListCard, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, PageSkeleton,
  SectionHeader, StatusTimeline, type DescriptionItem, type StatusEvent,
} from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useSession } from '../shell/session'
import i18n from '../i18n'
import es from '../locales/es/pages.console-docs-page.json'
import en from '../locales/en/pages.console-docs-page.json'
import {
  canManageWorkspaceDocNotes, createDocNote, deleteDocNote, fetchWorkspaceDocs, updateDocNote,
  type WorkspaceDocNote, type WorkspaceDocService, type WorkspaceDocsResponse,
} from './consoleDocs/api'

i18n.addResourceBundle('es', 'pages.console-docs-page', es)
i18n.addResourceBundle('en', 'pages.console-docs-page', en)

// Missing response timestamps never produce synthetic activity or edit attribution.
export function documentationEvents(data: WorkspaceDocsResponse, labels: { generation: string; noteCreated: string; noteEdited: string }): StatusEvent[] {
  const events: StatusEvent[] = []
  const add = (id: string, at: string, status: string, title: string, actor?: string) => {
    if (at) events.push({ id, at, status, title, actor, tone: 'neutral', description: undefined, live: false })
  }
  add('generated', data.generatedAt, labels.generation, '')
  for (const note of data.customNotes) {
    add(`created-${note.noteId}`, note.createdAt, labels.noteCreated, note.noteId, note.authorId || undefined)
    if (note.updatedAt && note.updatedAt !== note.createdAt) add(`edited-${note.noteId}`, note.updatedAt, labels.noteEdited, note.noteId)
  }
  return events.sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)))
}

function Metadata({ title, titleAs, items }: { title: string; titleAs: 'h2' | 'h3'; items: DescriptionItem[] }) {
  const { t } = useTranslation('pages.console-docs-page')
  const announce = useAnnounce()
  return <DescriptionListCard title={title} description="" items={items} wrap={true} columns={1} titleAs={titleAs}
    onEdit={undefined} editLabel="" onCopy={(item) => announce(t('copiedLabel', { label: item.label }))} className="min-w-0"
    labels={{ title, description: '', edit: '', copy: (label) => t('copyLabel', { label }), copied: (label) => t('copiedLabel', { label }), copiedToClipboard: t('copied') }} />
}
const item = (id: string, label: string, value: string, render?: DescriptionItem['render'], copyable = false): DescriptionItem => ({
  id, label, value, render, status: undefined, mono: false, copyable, copyValue: value,
})

function Service({ service }: { service: WorkspaceDocService }) {
  const { t } = useTranslation('pages.console-docs-page')
  const announce = useAnnounce()
  const [selected, setSelected] = useState(() => sessionStorage.getItem(`docs-snippet-tab-${service.serviceKey}`) ?? '')
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const active = service.snippets.find((snippet) => snippet.id === selected) ?? service.snippets[0]
  return <details open className="min-w-0 space-y-3">
    <summary className="cursor-pointer rounded text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">{service.label}</summary>
    <Metadata title={service.label} titleAs="h3" items={[
      item('category', t('category'), service.category), item('endpoint', t('endpoint'), service.endpoint),
      ...(service.port ? [item('port', t('port'), String(service.port))] : []),
    ]} />
    {active && <Tabs value={active.id} defaultValue={undefined} onValueChange={(value) => {
      const id = String(value)
      sessionStorage.setItem(`docs-snippet-tab-${service.serviceKey}`, id)
      setSelected(id)
    }}>
      <TabsList aria-label={t('snippetTabs', { service: service.label })} className="max-w-full flex-wrap">
        {service.snippets.map((snippet) => <TabsTab key={snippet.id} value={snippet.id}>{snippet.label}</TabsTab>)}
      </TabsList>
      {service.snippets.map((snippet) => <TabsPanel key={snippet.id} value={snippet.id} keepMounted={false} className="min-w-0 space-y-2">
        <CodeBlock code={snippet.code} language={undefined} filename={undefined} showLineNumbers={false} highlightLines={[]}
          defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined}
          label={t('snippetCode', { service: service.label })} className="min-w-0" ref={undefined} />
        <Button type="button" variant="secondary" size="sm" aria-label={copied === snippet.id ? t('copied') : t('copyLabel', { label: snippet.label })}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(snippet.code)
              setCopied(snippet.id); announce(t('copied'))
              clearTimeout(timer.current)
              timer.current = setTimeout(() => setCopied(null), 2000)
            } catch { announce(t('copyError'), 'assertive') }
          }}>{copied === snippet.id ? t('copied') : t('copy')}</Button>
        {snippet.secretPlaceholderRef !== null && <Text as="p" variant="supporting" tone="muted">{snippet.secretPlaceholderRef}</Text>}
      </TabsPanel>)}
    </Tabs>}
  </details>
}

function Notes({ workspaceId, notes, onChange }: { workspaceId: string; notes: WorkspaceDocNote[]; onChange: (update: (notes: WorkspaceDocNote[]) => WorkspaceDocNote[]) => void }) {
  const { t } = useTranslation('pages.console-docs-page')
  const canManage = canManageWorkspaceDocNotes(useSession()?.principal?.platformRoles)
  const announce = useAnnounce()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<{ type: 'create' } | { type: 'update'; noteId: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [target, setTarget] = useState<WorkspaceDocNote | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const deleted = useRef(false)
  const notify = (message: string) => { announce(message); toast.add({ title: message, tone: 'success' }) }
  async function save(note?: WorkspaceDocNote) {
    if (pending || (!note && !draft.trim())) return
    setActionError(null); setPending(note ? { type: 'update', noteId: note.noteId } : { type: 'create' })
    try {
      if (note) {
        const updated = await updateDocNote(workspaceId, note.noteId, editing[note.noteId] ?? note.content)
        onChange((current) => current.map((value) => value.noteId === note.noteId ? updated : value))
        setEditing((current) => { const next = { ...current }; delete next[note.noteId]; return next })
        notify(t('updated'))
      } else {
        const created = await createDocNote(workspaceId, draft)
        onChange((current) => [...current, created]); setDraft(''); notify(t('created'))
      }
    } catch (error) {
      // Legacy preserves Error messages, but uses the localized fallback for API envelopes.
      const message = error instanceof Error && error.message.trim() ? error.message : t(note ? 'updateError' : 'createError')
      setActionError(message); announce(message, 'assertive')
    } finally { setPending(null) }
  }
  async function remove() {
    if (!target || deleting) return
    setDeleting(true); setDeleteError(null); dialog.current?.focus()
    try {
      await deleteDocNote(workspaceId, target.noteId)
      onChange((current) => current.filter((note) => note.noteId !== target.noteId))
      deleted.current = true; setTarget(null); notify(t('deleted'))
    } catch (error) {
      const failure = error as Partial<ApiError> & { preLocalized?: boolean }
      const status = failure?.status
      const message = failure?.preLocalized && failure.message?.trim() ? failure.message :
        t(status && [401, 403, 404, 409, 429].includes(status) ? `delete${status}` : status && status >= 500 ? 'delete500' : 'deleteError')
      setDeleteError(message); announce(message, 'assertive'); dialog.current?.focus()
    } finally { setDeleting(false) }
  }
  return <section aria-label={t('notesRegion')} className="min-w-0 space-y-4">
    <h2 ref={heading} tabIndex={-1} className="rounded text-lg font-semibold focus-visible:outline-2 focus-visible:outline-focus-ring">{t('notes')}</h2>
    {!canManage && <Text as="p" variant="supporting" tone="muted">{t('readOnly')}</Text>}
    {canManage && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Textarea aria-label={t('newNote')} aria-describedby={actionError ? 'workspace-doc-note-action-error' : undefined}
        placeholder={t('placeholder')} value={draft} onValueChange={setDraft} disabled={pending !== null}
        clearable={false} clearLabel="" onClear={undefined} rows={3} size="md" resize="vertical" autosize={false} invalid={Boolean(actionError)} />
      <Button type="submit" disabled={!draft.trim() || pending !== null} aria-busy={pending?.type === 'create'} variant="primary" size="md" className="w-full sm:w-auto">
        {pending?.type === 'create' ? t('adding') : t('add')}
      </Button>
    </form>}
    {actionError && <div id="workspace-doc-note-action-error"><InlineCallout tone="destructive" title={actionError} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} /></div>}
    {notes.length ? notes.map((note) => <article key={note.noteId} className="space-y-3 border-t border-border pt-4">
      {canManage ? <Textarea aria-label={t('editNote', { noteId: note.noteId })} value={editing[note.noteId] ?? note.content}
        onValueChange={(value) => setEditing((current) => ({ ...current, [note.noteId]: value }))} disabled={pending !== null}
        clearable={false} clearLabel="" onClear={undefined} rows={3} size="md" resize="vertical" autosize={false} invalid={false} /> : <Text as="p" className="whitespace-pre-wrap">{note.content}</Text>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text as="p" variant="supporting" tone="muted">{t('author')} <span>{note.authorId}</span></Text>
        {canManage && <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={pending !== null} aria-busy={pending?.type === 'update' && pending.noteId === note.noteId} onClick={() => void save(note)}>{pending?.type === 'update' && pending.noteId === note.noteId ? t('saving') : t('save')}</Button>
          <Button type="button" variant="destructive" size="sm" disabled={pending !== null} aria-haspopup="dialog" onClick={(event) => {
            trigger.current = event.currentTarget; deleted.current = false; setActionError(null); setDeleteError(null); setTarget(note)
          }}>{t('delete')}</Button>
        </div>}
      </div>
    </article>) : <EmptyState title={t('noNotes')} description={null} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} />}
    <AlertDialog open={target !== null} onOpenChange={(open) => { if (!open && !deleting) setTarget(null) }}>
      <AlertDialogContent ref={dialog} size="sm" container={undefined} className="min-w-0 wrap-anywhere" finalFocus={() => deleted.current ? heading.current : trigger.current}>
        <AlertDialogHeader tone="destructive" icon={null}>
          <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <Text as="p">{t('confirmResource', { noteId: target?.noteId ?? '' })}</Text>
        <Text as="p">{t('confirmImpact', { workspaceId })}</Text>
        <Text as="p">{t('irreversible')}</Text>
        {deleteError && <div><InlineCallout tone="destructive" title={deleteError} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} /></div>}
        <AlertDialogFooter>
          <Button type="button" variant="secondary" size="md" disabled={deleting} onClick={() => setTarget(null)}>{t('cancel')}</Button>
          <Button type="button" variant="destructive" size="md" disabled={deleting} aria-busy={deleting} onClick={() => void remove()}>{deleting ? t('confirming') : t('confirm')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}

function LocalizedToaster() {
  const { t } = useTranslation('pages.console-docs-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 has no viewport label prop; scope the translated label to this portal.
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
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="" />}</>
}

function Documentation({ workspaceId }: { workspaceId: string }) {
  const { t, i18n: language } = useTranslation('pages.console-docs-page')
  const [data, setData] = useState<WorkspaceDocsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Partial<ApiError> | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setData(null); setError(null)
    void fetchWorkspaceDocs(workspaceId).then((response) => { if (active) setData(response) })
      .catch((cause: unknown) => { if (active) setError((cause as Partial<ApiError>) ?? {}) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, reload])
  const retry = () => setReload((value) => value + 1)
  const header = <div className="min-w-0 space-y-3">
    <PageHeader as="div" title={t('title')} wrapTitle={true} titleRef={undefined} description={null} breadcrumbs={null}
      status="" statuses={{}} meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined} className="min-w-0"
      labels={{ title: t('title'), description: '', moreActions: t('refresh'), sections: t('title') }} />
    <Button type="button" variant="secondary" size="md" disabled={loading} aria-label={t('refreshLabel')} onClick={retry} className="w-full sm:w-auto">{t('refresh')}</Button>
  </div>
  if (error?.status === 401) return null // The session client and authenticated shell refresh and redirect.
  return <Page width="default" header={header} actions={null} actionBar={null} className="min-w-0 wrap-anywhere">
    {loading ? <section aria-busy="true"><PageSkeleton stats={0} rows={4} label={t('loading')} className="min-w-0" /></section> :
      error?.status === 403 ? <NoAccessEmpty resource="" owner="" showRequestAccess={false} defaultRequested={false} onRequestAccess={undefined} action={undefined} titleAs="h2" bordered={false} className="min-w-0"
        labels={{ title: () => t('noAccess'), description: () => error.message ?? t('errorMessage'), request: '', requested: '', sent: '' }} /> :
      error?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={<Link href="/console/workspaces" underline="always">{t('back')}</Link>} titleAs="h2" bordered={false} className="min-w-0" /> :
      error || !data ? <ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error?.status ?? null} requestId={error?.requestId ?? ''} details=""
        onRetry={retry} retrying={false} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true} className="min-w-0"
        labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retryingStatus'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} /> : <>
        <Metadata title={t('summary')} titleAs="h2" items={[
          item('baseUrl', t('baseUrl'), data.baseUrl, undefined, true),
          ...(data.generatedAt ? [item('generatedAt', t('generatedAt'), data.generatedAt, <Timestamp value={data.generatedAt} format="absolute" locale={language.language} live={false} tooltip={false} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} fallback="" />)] : []),
        ]} />
        <section aria-label={t('timeline')} className="min-w-0 space-y-3">
          <SectionHeader title={t('timeline')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} className="min-w-0" />
          <StatusTimeline events={documentationEvents(data, { generation: t('generation'), noteCreated: t('noteCreated'), noteEdited: t('noteEdited') })} label={t('timeline')} emptyLabel={t('noActivity')}
            showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('actor')} maxVisible={3} timeFormat="absolute" className="min-w-0" />
        </section>
        <section aria-label={t('authRegion')}><Metadata title={t('auth')} titleAs="h2" items={[
          item('method', t('method'), data.authInstructions.method),
          ...(data.authInstructions.tokenEndpoint !== null ? [item('tokenEndpoint', t('tokenEndpoint'), data.authInstructions.tokenEndpoint)] : []),
          item('clientId', t('clientId'), data.authInstructions.clientIdPlaceholder), item('clientSecret', t('clientSecret'), data.authInstructions.clientSecretPlaceholder),
          item('scopes', t('scopes'), data.authInstructions.scopeHint), item('consoleRef', t('consoleRef'), data.authInstructions.consoleRef),
        ]} /></section>
        <section aria-label={t('services')} className="min-w-0 space-y-6">
          <SectionHeader title={t('services')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} className="min-w-0" />
          {data.enabledServices.length ? data.enabledServices.map((service) => <Service key={service.serviceKey} service={service} />) :
            <EmptyState title={t('noServices')} description={null} primaryAction={<Link href="/console/settings" underline="always">{t('settings')}</Link>} secondaryAction={null} titleAs="h3" bordered={false} />}
        </section>
        <Notes workspaceId={workspaceId} notes={data.customNotes} onChange={(update) => setData((current) => current ? { ...current, customNotes: update(current.customNotes) } : current)} />
      </>}
    <LocalizedToaster />
  </Page>
}

export default function ConsoleDocs() {
  const { workspaceId = '' } = useParams()
  const { i18n: language } = useTranslation('pages.console-docs-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer className=""><ToastProvider timeout={5000} limit={3}>
    <Documentation key={workspaceId} workspaceId={workspaceId} />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
