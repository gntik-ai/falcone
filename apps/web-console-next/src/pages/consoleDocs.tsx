import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { I18nProvider, Page, Button, Link, Timestamp, Textarea, Tabs, TabsList, TabsTab, TabsPanel, CodeBlock, EmptyState, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, LiveAnnouncer, useAnnounce, ToastProvider, Toaster, useToast } from '@gntik-ai/ui'
import { PageHeader, SectionHeader, DescriptionListCard, StatusTimeline, NotFoundEmpty, TableSkeleton, ErrorPanel, InlineCallout, type StatusEvent } from '@gntik-ai/blocks'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import es from '../locales/es/pages.console-docs-page.json'
import en from '../locales/en/pages.console-docs-page.json'
import { canManageWorkspaceDocNotes, fetchWorkspaceDocs, createDocNote, updateDocNote, deleteDocNote, type WorkspaceDocsResponse, type WorkspaceDocNote, type WorkspaceDocService } from './consoleDocs/api'

i18n.addResourceBundle('es', 'pages.console-docs-page', es)
i18n.addResourceBundle('en', 'pages.console-docs-page', en)

export function timelineEvents(data: WorkspaceDocsResponse, labels: { generated: string; created: string; edited: string }): StatusEvent[] {
  const events: StatusEvent[] = data.generatedAt ? [{ id: 'generated', status: labels.generated, title: '', at: data.generatedAt, tone: 'neutral', live: false }] : []
  for (const note of data.customNotes) {
    if (note.createdAt) events.push({ id: `${note.noteId}-created`, status: labels.created, title: note.noteId, at: note.createdAt, actor: note.authorId || undefined, tone: 'neutral', live: false })
    if (note.updatedAt && note.updatedAt !== note.createdAt) events.push({ id: `${note.noteId}-edited`, status: labels.edited, title: note.noteId, at: note.updatedAt, tone: 'neutral', live: false })
  }
  return events.sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)))
}

function Details({ title, rows }: { title: string; rows: { id: string; label: string; value: string; render?: ReactElement; copyable?: boolean; mono?: boolean }[] }) {
  const { t } = useTranslation('pages.console-docs-page')
  const announce = useAnnounce()
  return <DescriptionListCard title={title} description="" titleAs="h3" wrap={true} columns={1} onEdit={undefined} editLabel={t('edit')} onCopy={() => announce(t('copied'))}
    labels={{ title, description: '', edit: t('edit'), copy: (label) => t('copyValue', { label }), copied: (label) => t('copiedValue', { label }), copiedToClipboard: t('copied') }}
    items={rows.map((row) => ({ ...row, render: row.render ?? <span className="whitespace-pre-wrap wrap-anywhere">{row.value}</span>, mono: row.mono ?? false, copyable: row.copyable ?? false, copyValue: row.value, status: undefined }))} />
}

function Service({ service }: { service: WorkspaceDocService }) {
  const { t } = useTranslation('pages.console-docs-page')
  const announce = useAnnounce()
  const [selected, setSelected] = useState(() => {
    try { return sessionStorage.getItem(`docs-snippet-tab-${service.serviceKey}`) ?? service.snippets[0]?.id ?? '' } catch { return service.snippets[0]?.id ?? '' }
  })
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const active = service.snippets.find((snippet) => snippet.id === selected) ?? service.snippets[0]
  return <section className="min-w-0 space-y-3" aria-label={service.label}>
    <SectionHeader title={service.label} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} />
    <Details title={service.label} rows={[
      { id: 'category', label: t('category'), value: service.category },
      { id: 'endpoint', label: t('endpoint'), value: service.endpoint },
      ...(service.port ? [{ id: 'port', label: t('port'), value: String(service.port) }] : []),
    ]} />
    {active && <Tabs value={active.id} onValueChange={(value) => {
      const next = String(value)
      try { sessionStorage.setItem(`docs-snippet-tab-${service.serviceKey}`, next) } catch { /* Keep the active tab when storage is unavailable. */ }
      setSelected(next); setCopied(null)
    }}>
      <TabsList aria-label={t('snippets', { service: service.label })} className="flex-wrap"><>{service.snippets.map((snippet) => <TabsTab key={snippet.id} value={snippet.id}>{snippet.label}</TabsTab>)}</></TabsList>
      {service.snippets.map((snippet) => <TabsPanel key={snippet.id} value={snippet.id} className="min-w-0 space-y-2">
        <CodeBlock code={snippet.code} language={undefined} filename={snippet.label} label={t('snippetCode', { snippet: snippet.label })} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(code) => code} />
        <Button type="button" variant="secondary" size="sm" onClick={async () => {
          try {
            await navigator.clipboard.writeText(snippet.code)
            setCopied(snippet.id); announce(t('copied'))
            clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(null), 2000)
          } catch { announce(t('copyError'), 'assertive') }
        }}>{copied === snippet.id ? t('copied') : t('copy')}</Button>
        {snippet.secretPlaceholderRef !== null && <p className="text-sm text-muted-foreground wrap-anywhere">{snippet.secretPlaceholderRef}</p>}
      </TabsPanel>)}
    </Tabs>}
  </section>
}

function Notes({ workspaceId, notes, setNotes }: { workspaceId: string; notes: WorkspaceDocNote[]; setNotes: (update: (current: WorkspaceDocNote[]) => WorkspaceDocNote[]) => void }) {
  const { t } = useTranslation('pages.console-docs-page')
  const announce = useAnnounce()
  const toast = useToast()
  const canManage = canManageWorkspaceDocNotes(readConsoleShellSession()?.principal?.platformRoles)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<WorkspaceDocNote | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const deleted = useRef(false)
  const busyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  useEffect(() => { if (deleteError && !deleteBusy) confirmButton.current?.focus() }, [deleteError, deleteBusy])
  const success = (message: string) => { toast.add({ title: message, tone: 'success', description: null, priority: 'low' }); announce(message) }
  async function save(note?: WorkspaceDocNote) {
    if (!canManage || busyRef.current || (!note && !draft.trim())) return
    busyRef.current = true; setPending(note?.noteId ?? 'create'); setError(null)
    try {
      const result = note ? await updateDocNote(workspaceId, note.noteId, editing[note.noteId] ?? note.content) : await createDocNote(workspaceId, draft)
      setNotes((current) => note ? current.map((item) => item.noteId === note.noteId ? result : item) : [...current, result])
      if (note) setEditing((current) => { const next = { ...current }; delete next[note.noteId]; return next })
      else setDraft('')
      success(t(note ? 'saved' : 'created'))
    } catch (cause) {
      const message = cause instanceof Error && cause.message.trim() ? cause.message : t(note ? 'updateError' : 'createError')
      setError(message); announce(message, 'assertive')
    } finally { busyRef.current = false; setPending(null) }
  }
  async function confirmDelete() {
    if (!deleting || !canManage || deleteBusyRef.current) return
    deleteBusyRef.current = true; setDeleteBusy(true); setDeleteError(null)
    try {
      await deleteDocNote(workspaceId, deleting.noteId)
      setNotes((current) => current.filter((item) => item.noteId !== deleting.noteId))
      deleted.current = true; setDeleting(null); success(t('deleted'))
    } catch (cause) {
      const status = (cause as Partial<ApiError>)?.status
      const key = status === 401 ? 'deleteUnauthorized' : status === 404 ? 'deleteMissing' : status === 403 ? 'deleteForbidden' : status === 409 ? 'deleteConflict' : status === 429 ? 'deleteRateLimit' : status && status >= 500 ? 'deleteUnavailable' : 'deleteError'
      const message = t(key)
      setDeleteError(message); announce(message, 'assertive')
    } finally { deleteBusyRef.current = false; setDeleteBusy(false) }
  }
  return <section aria-label={t('notesRegion')} className="space-y-4">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">{t('notes')}</h2>
    {!canManage && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
    {canManage && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <Textarea aria-label={t('newNote')} aria-describedby={error ? 'workspace-doc-note-action-error' : undefined} placeholder={t('placeholder')} value={draft} onValueChange={setDraft} disabled={pending !== null} clearable={false} rows={3} />
      <Button type="submit" variant="primary" size="md" disabled={!draft.trim() || pending !== null} aria-busy={pending === 'create'} className="w-full sm:w-auto">{t(pending === 'create' ? 'adding' : 'add')}</Button>
    </form>}
    {error && <div id="workspace-doc-note-action-error"><InlineCallout tone="destructive" title={error} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} /></div>}
    <div className="divide-y divide-border">{notes.map((note) => <article key={note.noteId} className="space-y-3 py-4">
      {canManage ? <Textarea aria-label={t('editNote', { note: note.noteId })} value={editing[note.noteId] ?? note.content} onValueChange={(value) => setEditing((current) => ({ ...current, [note.noteId]: value }))} disabled={pending !== null} clearable={false} rows={3} /> : <p className="whitespace-pre-wrap wrap-anywhere">{note.content}</p>}
      <p className="text-sm text-muted-foreground">{t('author', { author: note.authorId })}</p>
      {canManage && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending !== null} aria-busy={pending === note.noteId} onClick={() => void save(note)}>{t(pending === note.noteId ? 'saving' : 'save')}</Button>
        <Button type="button" variant="destructive" size="sm" disabled={pending !== null} aria-haspopup="dialog" onClick={(event) => {
          deleteTrigger.current = event.currentTarget; deleted.current = false; setError(null); setDeleteError(null); setDeleting(note)
        }}>{t('delete')}</Button>
      </div>}
    </article>)}</div>
    {!notes.length && <EmptyState title={t('noNotes')} description={null} titleAs="h3" primaryAction={null} secondaryAction={null} bordered={false} />}
    <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open && !deleteBusyRef.current) setDeleting(null) }}>
      <AlertDialogContent size="sm" finalFocus={() => deleted.current ? heading.current : deleteTrigger.current}>
        <AlertDialogHeader tone="destructive" icon={undefined}>
          <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="wrap-anywhere">{t('deleteTarget', { note: deleting?.noteId ?? '' })}</p>
        <p className="wrap-anywhere">{t('deleteImpact', { workspace: workspaceId })}</p>
        <p>{t('irreversible')}</p>
        {deleteError && <p role="alert" className="text-destructive-text">{deleteError}</p>}
        <AlertDialogFooter>
          <Button type="button" variant="secondary" size="md" disabled={deleteBusy} onClick={() => setDeleting(null)}>{t('cancel')}</Button>
          <Button ref={confirmButton} type="button" variant="destructive" size="md" disabled={deleteBusy} aria-busy={deleteBusy} onClick={() => void confirmDelete()}>{t(deleteBusy ? 'confirming' : 'confirm')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}

function Docs({ workspaceId }: { workspaceId: string }) {
  const { t, i18n: language } = useTranslation('pages.console-docs-page')
  const [data, setData] = useState<WorkspaceDocsResponse | null>(null)
  const [error, setError] = useState<Partial<ApiError> | null>(null)
  const [busy, setBusy] = useState(true)
  const inFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(false)
  const refresh = useRef<HTMLButtonElement>(null)
  const recovering = useRef(false)
  function load() {
    if (inFlight.current) return inFlight.current
    recovering.current = Boolean(error)
    setBusy(true)
    const request = fetchWorkspaceDocs(workspaceId).then((next) => {
      if (mounted.current) { setData(next); setError(null) }
    }).catch((cause: Partial<ApiError>) => {
      if (mounted.current) { setData(null); setError(cause) }
    }).finally(() => { inFlight.current = null; if (mounted.current) setBusy(false) })
    inFlight.current = request
    return request
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [workspaceId])
  useEffect(() => { if (!busy && !error && recovering.current) { recovering.current = false; refresh.current?.focus() } }, [busy, error])
  const header = <PageHeader as="div" title={<span className="block whitespace-normal wrap-anywhere">{t('title')}</span>} description={null} breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: '', moreActions: t('actions'), sections: t('sections') }} />
  const back = <Link href="/console/workspaces" underline="always">{t('back')}</Link>
  if (error?.status === 401) return null // The shared session client and authenticated shell own refresh and redirect.
  return <Page width="default" header={header} actions={null} actionBar={null} className="console-docs min-w-0 wrap-anywhere">
    {error?.status === 403 ? <EmptyState title={t('noAccess')} description={error.message ?? t('noAccessDescription')} titleAs="h2" primaryAction={null} secondaryAction={null} bordered={false} />
      : error?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={back} titleAs="h2" bordered={false} />
      : error ? <ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={busy} onRetry={load}
        labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
      : busy || !data ? <TableSkeleton rows={6} columns={2} label={t('loading')} /> : <>
        <Button ref={refresh} type="button" variant="secondary" size="md" aria-label={t('refreshLabel')} onClick={() => void load()} className="w-full sm:w-auto">{t('refresh')}</Button>
        <Details title={t('summary')} rows={[
          { id: 'baseUrl', label: t('baseUrl'), value: data.baseUrl, copyable: true, mono: true },
          { id: 'generatedAt', label: t('generatedAt'), value: data.generatedAt, render: <Timestamp value={data.generatedAt} format="absolute" locale={language.language} dateOptions={{ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }} /> },
        ]} />
        <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-6 xl:col-span-2">
            <section aria-label={t('authRegion')} className="min-w-0 space-y-3">
              <SectionHeader title={t('auth')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} />
              <Details title={t('auth')} rows={[
                { id: 'method', label: t('method'), value: data.authInstructions.method },
                ...(data.authInstructions.tokenEndpoint !== null ? [{ id: 'tokenEndpoint', label: t('tokenEndpoint'), value: data.authInstructions.tokenEndpoint }] : []),
                ...(['clientIdPlaceholder', 'clientSecretPlaceholder', 'scopeHint', 'consoleRef'] as const).map((key) => ({ id: key, label: t(key), value: data.authInstructions[key] })),
              ]} />
            </section>
            <section aria-label={t('servicesRegion')} className="min-w-0 space-y-4">
              <SectionHeader title={t('servicesRegion')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} />
              {data.enabledServices.length ? data.enabledServices.map((service) => <Service key={service.serviceKey} service={service} />) : <EmptyState title={t('noServices')} description={null} titleAs="h3" primaryAction={<Link href="/console/settings" underline="always">{t('settings')}</Link>} secondaryAction={null} bordered={false} />}
            </section>
          </div>
          <section aria-label={t('timeline')} className="min-w-0 space-y-3">
            <SectionHeader title={t('timeline')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} />
            <StatusTimeline events={timelineEvents(data, { generated: t('generated'), created: t('noteCreated'), edited: t('noteEdited') })} label={t('timeline')} emptyLabel={t('noActivity')} showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('actor')} maxVisible={3} timeFormat="absolute" />
          </section>
        </div>
        <Notes workspaceId={workspaceId} notes={data.customNotes} setNotes={(update) => setData((current) => current ? { ...current, customNotes: update(current.customNotes) } : current)} />
      </>}
    <Toaster closeLabel={t('closeToast')} />
  </Page>
}

export default function ConsoleDocsPage() {
  const { workspaceId = '' } = useParams()
  const { i18n: language } = useTranslation('pages.console-docs-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={4000} limit={3}><Docs key={workspaceId} workspaceId={workspaceId} /></ToastProvider></LiveAnnouncer></I18nProvider>
}
