import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Field, FieldLabel, Input, JsonViewer, Link, PasswordInput, SimpleSelect, StatusDot, Text, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, FirstRunEmpty, FormSection, InlineCallout, ListSkeleton, LogViewer, NoResultsEmpty, NotFoundEmpty, type LogLine } from '@gntik-ai/blocks'
import { buildTarget, pushChange, resolveSelected, toEntry, type ChangeEntry, type Source } from './changes'
import { openRealtimeStream, realtimeChangesUrl, type RealtimeStream, type StreamFailure } from './stream'

const NAMESPACE = 'pages.console-realtime-changes-page'
// A burst of frames is announced once, with its size.
export const ANNOUNCE_WINDOW_MS = 400
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

type Phase = 'idle' | 'connecting' | 'live' | 'disconnected' | 'failed'
type Attention = { seq: number; target: 'retry' | 'database' }

// Stays mounted across workspace changes so the form survives them; without a workspace it renders `gate`.
export function RealtimeConsole({ workspaceId, gate }: { workspaceId: string | null; gate: ReactNode }) {
  const { t, i18n: language } = useTranslation(NAMESPACE)
  const announce = useAnnounce()
  const ids = { source: useId(), database: useId(), collection: useId(), schema: useId(), table: useId(), key: useId() }
  const root = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<Source>('mongo')
  const [database, setDatabase] = useState('')
  const [collection, setCollection] = useState('')
  const [schema, setSchema] = useState('public')
  const [table, setTable] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [changes, setChanges] = useState<ChangeEntry[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [dropped, setDropped] = useState(false)
  const [failure, setFailure] = useState<StreamFailure | null>(null)
  const [validation, setValidation] = useState<Source | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [attention, setAttention] = useState<Attention | null>(null)

  const stream = useRef<RealtimeStream | null>(null)
  const generation = useRef(0)
  const sequence = useRef(0)
  const attentionSeq = useRef(0)
  const pending = useRef(0)
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedback = useRef({ t, announce })
  // Asynchronous stream callbacks announce with the current locale.
  useLayoutEffect(() => { feedback.current = { t, announce } }, [t, announce])

  const clearAnnouncement = () => {
    if (announceTimer.current !== null) clearTimeout(announceTimer.current)
    announceTimer.current = null; pending.current = 0
  }
  const queueAnnouncement = () => {
    pending.current += 1
    if (announceTimer.current !== null) return
    announceTimer.current = setTimeout(() => {
      announceTimer.current = null
      const count = pending.current
      pending.current = 0
      feedback.current.announce(feedback.current.t('announceChanges', { count }), 'polite')
    }, ANNOUNCE_WINDOW_MS)
  }
  const ask = (target: Attention['target']) => setAttention({ seq: ++attentionSeq.current, target })

  const stop = useCallback(() => {
    generation.current++
    stream.current?.close(); stream.current = null
    clearAnnouncement()
  }, [])
  // The stream never outlives the page.
  useEffect(() => stop, [stop])
  // A workspace change closes the open stream and drops its results; the form stays as typed.
  useEffect(() => {
    stop()
    setChanges([]); setSelectedId(null); setDropped(false); setFailure(null); setPhase('idle')
  }, [workspaceId, stop])

  function subscribe() {
    if (!workspaceId) return
    setValidation(null)
    const built = buildTarget({ source, database, collection, schema, table, apiKey })
    if (!built) { setValidation(source); return }
    stop()
    const current = generation.current
    const active = () => current === generation.current
    setChanges([]); setSelectedId(null); setDropped(false); setFailure(null); setPhase('connecting')
    feedback.current.announce(feedback.current.t('announceConnecting'), 'polite')
    stream.current = openRealtimeStream({
      url: realtimeChangesUrl({ workspaceId, target: built.target, apiKey: built.apiKey }),
      handlers: {
        onOpen: () => { if (active()) setPhase('live') },
        onChange: (change, eventName) => {
          if (!active()) return
          const entry = toEntry(change, eventName, `change-${++sequence.current}`, new Date())
          setChanges((list) => pushChange(list, entry))
          setDropped(false); setPhase('live')
          queueAnnouncement()
        },
        onDrop: () => {
          if (!active()) return
          setPhase('disconnected'); setDropped(true); ask('retry')
          feedback.current.announce(feedback.current.t('announceDropped'), 'assertive')
        },
        onFailure: (next) => {
          if (!active()) return
          stream.current = null
          setPhase('failed'); setFailure(next)
          // A rejected key is fixed in the form; a missing stream sends focus back to the target.
          if (next.status === 404) ask('database')
          else if (next.status !== 401 && next.status !== 403) ask('retry')
          feedback.current.announce(feedback.current.t('announceFailure'), 'assertive')
        },
      },
    })
  }

  function stopStream() {
    stop()
    setPhase('idle'); setDropped(false); setFailure(null)
  }

  const focusKey = () => document.getElementById(ids.key)?.focus()
  useEffect(() => {
    if (!attention) return
    if (attention.target === 'database') document.getElementById(ids.database)?.focus()
    else Array.from(root.current?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === t('retry'))?.focus()
    // Only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention])

  const streaming = phase === 'connecting' || phase === 'live' || phase === 'disconnected'
  const selected = resolveSelected(changes, selectedId)
  const stale = dropped
  const lines = useMemo<LogLine[]>(() => changes.map((change) => ({
    id: change.id, timestamp: change.receivedAt, level: change.level,
    message: `${stale ? `[${t('stale')}] ` : ''}${change.known ? '' : `${change.type} `}${change.json}`,
  })), [changes, stale, t])
  const total = changes.length
  // Every hook above runs for every render, so the gate can replace the console here.
  if (!workspaceId) return <>{gate}</>

  const statusLabel = phase === 'connecting' ? t('statusConnecting') : phase === 'live' ? t('statusLive') : t('statusDisconnected')
  const statusTone = phase === 'live' ? 'success' : phase === 'connecting' ? 'warning' : phase === 'idle' ? 'neutral' : 'destructive'
  const retry = () => subscribe()
  const panelLabels = { title: '', message: '', support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }
  const panel = (title: string, message: string, code: number | null, requestId: string) =>
    <ErrorPanel title={title} message={message} code={code} requestId={requestId} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
      labels={{ ...panelLabels, title, message }} />

  const failureView = () => {
    if (!failure) return null
    if (failure.status === 401 || failure.status === 403) {
      return <EmptyState icon={undefined} title={t('noAccessTitle')} description={t('noAccessDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0"
        primaryAction={<Button type="button" variant="secondary" size="md" disabled={false} loading={false} onClick={focusKey}>{t('noAccessAction')}</Button>} />
    }
    if (failure.status === 404) {
      const links = source === 'mongo' ? (['mongo', 'postgres'] as const) : (['postgres', 'mongo'] as const)
      return <NotFoundEmpty icon={undefined} title={t('notFoundTitle')} description={t('notFoundDescription')} titleAs="h2" bordered={false} className="min-w-0"
        action={<div className="flex flex-wrap items-center justify-center gap-3">{links.map((name) =>
          <Link key={name} href={`/console/${name}`} tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t(name === 'mongo' ? 'notFoundMongo' : 'notFoundPostgres')}</Link>)}</div>} />
    }
    const requestId = failure.requestId ?? ''
    return panel(t('errorTitle'), requestId ? t('errorDescription') : `${t('errorDescription')} ${t('noRequestId')}`, failure.status ?? null, requestId)
  }

  const logLabels = {
    title: t('logTitle'), levelFilter: t('logLevelFilter'), searchLabel: t('logSearch'), searchPlaceholder: t('logSearchPlaceholder'), follow: t('logFollow'), empty: t('logEmpty'), copied: t('logCopied'),
    levels: { info: t('typeInsert'), warn: t('typeUpdate'), debug: t('typeReplace'), error: t('typeDelete') },
    count: (visible: number, all: number) => visible === all ? t('logCountAll', { total: all }) : t('logCountFiltered', { visible, total: all }),
    inspect: (timestamp: string) => t('logInspect', { timestamp }),
    copy: (timestamp: string) => t('logCopy', { timestamp }),
  }
  const jsonLabels = {
    copyPath: t('jsonCopyPath'), copyValue: t('jsonCopyValue'), copied: t('jsonCopied'), copyFailed: t('jsonCopyFailed'), selectHint: t('jsonSelectHint'), truncated: t('jsonTruncated'), copyFullHint: t('jsonCopyFullHint'),
    keys: (count: number) => t('jsonKeys', { count }), items: (count: number) => t('jsonItems', { count }), root: t('jsonRoot'),
  }

  const logRegion = () => {
    if (total > 0) {
      return <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <section aria-labelledby={`${ids.key}-json`} className="order-2 flex min-w-0 flex-col gap-3">
          <h2 id={`${ids.key}-json`} className="text-base font-semibold text-foreground">{t('jsonTitle')}</h2>
          <Field invalid={false} className="w-full min-w-0">
            <FieldLabel htmlFor={`${ids.key}-change`}>{t('selectorLabel')}</FieldLabel>
            <SimpleSelect id={`${ids.key}-change`} value={selected?.id ?? ''} defaultValue="" placeholder={t('selectorPlaceholder')} clearable={false} size="md" className="w-full min-w-0"
              items={changes.map((change, index) => ({ value: change.id, label: t('changeOption', { position: index + 1, type: change.type }) }))}
              onValueChange={(value) => { if (value) setSelectedId(value) }} />
          </Field>
          <JsonViewer data={selected?.document ?? null} label={t('jsonLabel')} defaultExpandDepth={1} maxDepth={undefined} search="" toolbar={true} maxHeight={320} maxDisplayChars={undefined} emptyContent={undefined} labels={jsonLabels} className="min-w-0" />
        </section>
        <LogViewer lines={lines} title={t('logTitle')} labels={logLabels} height={360} rowHeight={24} wrap={true} overscan={8} defaultLevels={['debug', 'info', 'warn', 'error']} defaultFollow={false}
          onCopyLine={undefined} onSelectLine={(line) => setSelectedId(line.id)} selectedLineId={selected?.id} announceLines={false} titleAs="h2" className="order-1 min-w-0" />
      </div>
    }
    if (phase === 'connecting') return <div className="min-w-0" aria-hidden={true}><ListSkeleton rows={3} label={t('connecting')} className="min-w-0" /></div>
    if (phase === 'live') {
      return <NoResultsEmpty query="" filterCount={0} entity="" titleAs="h2" bordered={false} className="min-w-0" onClearFilters={undefined} onClearSearch={undefined}
        labels={{ title: () => t(source === 'mongo' ? 'listeningMongo' : 'listeningPostgres'), description: () => '', clearFilters: '', clearSearch: '' }} />
    }
    if (phase === 'idle') {
      return <FirstRunEmpty icon={undefined} title={t('firstRunTitle')} description={t('firstRunDescription')} actionLabel={t('firstRunAction')} onAction={() => document.getElementById(ids.database)?.focus()}
        secondary={null} steps={[t('firstRunStep1'), t('firstRunStep2'), t('firstRunStep3')]} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: t('firstRunTitle'), description: t('firstRunDescription'), action: t('firstRunAction'), guide: '' }} />
    }
    return null
  }

  const field = (id: string, label: string, value: string, onValueChange: (value: string) => void) =>
    <Field invalid={false} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onValueChange={(next) => onValueChange(String(next))} autoComplete="off" spellCheck={false} className="w-full min-w-0" /></Field>

  return <section ref={root} aria-label={t('consoleLabel')} className="min-w-0 space-y-6">
    <FormSection labels={{ title: t('formTitle'), description: t('formDescription') }} title={t('formTitle')} description={t('formDescription')} headingLevel="h2" divided={false} className="min-w-0"
      actions={<div className="flex min-w-0 flex-wrap items-center gap-3">
        {streaming
          ? <Button type="button" variant="secondary" size="md" disabled={false} loading={false} onClick={stopStream}>{t('stop')}</Button>
          : <Button type="button" variant="primary" size="md" disabled={false} loading={false} onClick={subscribe}>{t('subscribe')}</Button>}
        <Text as="span" variant="supporting" tone="muted">{t('statusLabel')}</Text>
        <StatusDot tone={statusTone} size="md" label={statusLabel} pulse={phase === 'connecting' || phase === 'live'} />
      </div>}>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor={ids.source}>{t('source')}</FieldLabel>
          <SimpleSelect id={ids.source} value={source} defaultValue="mongo" placeholder={undefined} clearable={false} size="md" className="w-full min-w-0"
            items={[{ value: 'mongo', label: t('sourceMongo') }, { value: 'postgres', label: t('sourcePostgres') }]}
            onValueChange={(value) => { if (value === 'mongo' || value === 'postgres') setSource(value) }} /></Field>
        {field(ids.database, t('database'), database, setDatabase)}
        {source === 'mongo'
          ? field(ids.collection, t('collection'), collection, setCollection)
          : <>{field(ids.schema, t('schema'), schema, setSchema)}{field(ids.table, t('table'), table, setTable)}</>}
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor={ids.key}>{t('anonKey')}</FieldLabel>
          <PasswordInput id={ids.key} value={apiKey} onValueChange={(next) => setApiKey(String(next))} placeholder={t('anonKeyPlaceholder')} showLabel={t('showKey')} hideLabel={t('hideKey')} showStrength={false}
            autoComplete="off" spellCheck={false} className="w-full min-w-0" wrapperClassName="min-w-0" /></Field>
      </div>
    </FormSection>

    {validation ? <InlineCallout tone="destructive" title={t(validation === 'mongo' ? 'validationMongo' : 'validationPostgres')} labels={{ title: t(validation === 'mongo' ? 'validationMongo' : 'validationPostgres') }} description="" actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /> : null}
    {failure || dropped ? <InlineCallout tone="destructive" title={t('streamError')} labels={{ title: t('streamError') }} description="" actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /> : null}
    {failure ? failureView() : dropped ? panel(t('droppedTitle'), t('droppedDescription'), null, '') : null}
    {logRegion()}
  </section>
}
