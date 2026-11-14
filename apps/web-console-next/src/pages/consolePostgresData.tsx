import { Fragment, useEffect, useRef, useState } from 'react'
import { I18nProvider, LiveAnnouncer, Page, Toolbar, ToastProvider, useAnnounce, useHasLiveAnnouncer, useToast } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { focusRing, useCopy } from './consolePostgresData/copy'
import { Editor } from './consolePostgresData/Editor'
import { FirstRun, TextField } from './consolePostgresData/States'
import { LocalizedToaster } from './consolePostgresData/Toaster'
import { WorkspaceGate } from './consolePostgresData/WorkspaceGate'

// Supplies the active workspace and a database, schema and table to the row editor. The editor
// mounts only once a database and a table are entered; until then the page sends no request.
function Surface() {
  const { t } = useCopy(), context = useConsoleContext(), toast = useToast(), announce = useAnnounce()
  const workspaceId = context.activeWorkspaceId
  const [database, setDatabase] = useState(''), [schema, setSchema] = useState('public'), [table, setTable] = useState('')
  // Held here, above the editor and its target, so a target change cannot reset a pending mutation.
  const [busy, setBusy] = useState(false), [focusDatabase, setFocusDatabase] = useState(false)
  const databaseInput = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focusDatabase) { databaseInput.current?.focus(); setFocusDatabase(false) } }, [focusDatabase])
  if (!workspaceId) return <WorkspaceGate />
  const ready = database.trim() !== '' && table.trim() !== ''
  const notify = (message: string) => { toast.add({ title: message, tone: 'success' }); announce(message, 'polite') }
  return <>
    <Toolbar variant="plain" aria-label={t('targetLabel')} className="grid min-w-0 gap-4 sm:grid-cols-3">
      <TextField id="pg-db" label={t('database')} placeholder={t('databasePlaceholder')} value={database} onChange={setDatabase} inputRef={databaseInput} />
      <TextField id="pg-schema" label={t('schema')} placeholder={t('schemaPlaceholder')} value={schema} onChange={setSchema} />
      <TextField id="pg-table" label={t('table')} placeholder={t('tablePlaceholder')} value={table} onChange={setTable} />
    </Toolbar>
    {ready
      ? <Editor target={{ workspaceId, databaseName: database.trim(), schemaName: schema.trim() || 'public', tableName: table.trim() }} busy={busy} setBusy={setBusy} notify={notify}
          onBack={() => { setDatabase(''); setTable(''); setSchema('public'); setFocusDatabase(true) }} />
      : <FirstRun title={t('selectPrompt')} description={t('selectPromptDescription')} />}
  </>
}

export default function ConsolePostgresDataPage() {
  const { t, i18n } = useCopy()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('rowsLoading'), 'common.copy': t('copyKey'), 'common.copied': t('copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="postgres-data-page"
      header={<PageHeader as="header" wrapTitle={true} titleRef={(node) => { if (node) { node.id = 'pgdata-heading'; node.tabIndex = -1; node.classList.add(...focusRing.split(' ')) } }} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t('description')} breadcrumbs={[]} status="postgres" statuses={{ postgres: { label: t('badge'), tone: 'neutral' } }} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
      <Surface />
    </Page><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
