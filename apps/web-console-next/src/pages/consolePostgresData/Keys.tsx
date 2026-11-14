import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, CodeBlock, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, SecretField, StatusTag, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { InlineCallout, type DataTableColumn } from '@gntik-ai/blocks'
import { buildCurlSnippet, buildFrontendSnippet, collectColumns, copyToClipboard, failureOf, formatCell, issueApiKey, listApiKeys, previewRowsWithApiKey, revokeApiKey, type ApiKeyRecord, type Failure, type IssuedApiKey, type PgRow, type Target } from './api'
import { ConfirmTyped } from './ConfirmTyped'
import { focusRing, useCopy } from './copy'
import { Action, DataGrid, FailureView, Heading, Loading, NoRows } from './parts'

export type KeysState = { status: 'loading' | 'ready' | 'error'; items: ApiKeyRecord[]; failure: Failure | null }

// Keys are listed on every effect-driven rows reload, as legacy does (PostgresDataEditor.tsx:147-150).
export function useKeys(workspaceId: string) {
  const [state, setState] = useState<KeysState>({ status: 'loading', items: [], failure: null })
  const token = useRef(0), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const reload = useCallback(async () => {
    const mine = ++token.current
    setState((current) => ({ ...current, status: 'loading', failure: null }))
    try {
      const result = await listApiKeys(workspaceId)
      if (live.current && mine === token.current) setState({ status: 'ready', items: result.items ?? [], failure: null })
    } catch (cause) {
      if (live.current && mine === token.current) setState({ status: 'error', items: [], failure: failureOf(cause) })
    }
  }, [workspaceId])
  return { state, reload }
}

type Preview = { rows: PgRow[] | null; failure: string | null; busy: boolean }

export function KeyPanel({ target, keys, reload, onError }: { target: Target; keys: ReturnType<typeof useKeys>; reload: () => Promise<void>; onError: (message: string | null) => void }) {
  const { t } = useCopy(), announce = useAnnounce(), toast = useToast()
  const [issued, setIssued] = useState<IssuedApiKey | null>(null), [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false), [preview, setPreview] = useState<Preview>({ rows: null, failure: null, busy: false })
  const [revoking, setRevoking] = useState<{ key: ApiKeyRecord; trigger: HTMLElement | null } | null>(null)
  const heading = useRef<HTMLDivElement>(null), opener = useRef<HTMLElement | null>(null), issuing = useRef(false), previewToken = useRef(0), previewing = useRef(false)
  // A pending preview must not write into a dialog that was closed or replaced.
  useEffect(() => () => { previewToken.current++ }, [])

  async function issue(keyType: 'anon' | 'service', button: HTMLElement) {
    if (issuing.current) return
    issuing.current = true; onError(null)
    try {
      const key = await issueApiKey(target.workspaceId, keyType)
      previewToken.current++; previewing.current = false
      opener.current = button; setIssued(key); setOpen(true); setCopied(false); setPreview({ rows: null, failure: null, busy: false })
      announce(t('keys.issuedAnnounce'), 'polite')
      await reload()
    } catch (cause) { onError(failureOf(cause).message ?? t('requestFailed')) }
    finally { issuing.current = false }
  }
  async function runPreview() {
    if (!issued || previewing.current) return
    previewing.current = true
    const mine = ++previewToken.current
    setPreview({ rows: null, failure: null, busy: true })
    try {
      const result = await previewRowsWithApiKey(issued.key, target, { pageSize: 10 })
      if (mine === previewToken.current) setPreview({ rows: result.items ?? [], failure: null, busy: false })
    } catch (cause) {
      if (mine === previewToken.current) setPreview({ rows: null, failure: failureOf(cause).message ?? t('requestFailed'), busy: false })
    } finally { if (mine === previewToken.current) previewing.current = false }
  }
  async function copyKey() {
    if (!issued) return
    const ok = await copyToClipboard(issued.key)
    setCopied(ok); announce(t(ok ? 'keys.copied' : 'copyFailed'), 'polite')
  }
  async function revoke(key: ApiKeyRecord) {
    try {
      await revokeApiKey(target.workspaceId, key.id)
      await reload()
      const message = t('keys.revoked'); toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' }); announce(message, 'polite')
    } catch (cause) { onError(failureOf(cause).message ?? t('requestFailed')) }
  }
  const { state } = keys
  const statusTone = (status: string) => status === 'active' ? 'success' : 'neutral'
  const columns: DataTableColumn<ApiKeyRecord>[] = [
    { id: 'prefix', header: t('keys.prefix'), sortable: false, variant: 'mono', cell: (key) => `${key.key_prefix}…` },
    { id: 'type', header: t('keys.type'), sortable: false, cell: (key) => t(`keys.types.${key.key_type}`, { defaultValue: key.key_type }) },
    { id: 'status', header: t('keys.status'), sortable: false, cell: (key) => { const label = t(`keys.statuses.${key.status}`, { defaultValue: key.status }); return <StatusTag status={key.status} statuses={{ [key.status]: { label, tone: statusTone(key.status) } }} label={label} uppercase={false} variant="soft" size="sm" shape="rounded" className="max-w-full" /> } },
    { id: 'actions', header: t('actions'), sortable: false, cell: (key) => key.status === 'active' ? <Action variant="destructive" data-pgdata-revoke={key.id} aria-label={t('keys.revokeAria', { prefix: key.key_prefix })} onClick={(event) => setRevoking({ key, trigger: event.currentTarget })}>{t('keys.revoke')}</Action> : null },
  ]
  const snippetParams = issued ? { apiKey: issued.key, ...target, origin: typeof window !== 'undefined' ? window.location.origin : undefined } : null
  const previewColumns = preview.rows ? collectColumns(preview.rows) : []
  const previewRows = (preview.rows ?? []).map((row, index) => ({ key: `preview-${index}`, row }))
  return <section aria-label={t('keys.title')} className="min-w-0 space-y-4" data-testid="pgdata-keys" aria-busy={state.status === 'loading'}>
    <div ref={heading} tabIndex={-1} className={focusRing}><Heading title={t('keys.title')} description={t('keys.description')} /></div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={(event) => void issue('anon', event.currentTarget)}>{t('keys.issueAnon')}</Button>
      <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={(event) => void issue('service', event.currentTarget)}>{t('keys.issueService')}</Button>
    </div>
    {state.status === 'loading' && state.items.length === 0 ? <Loading label={t('keys.loading')} />
      : state.status === 'error' && state.failure ? <FailureView section="keys" error={state.failure} retry={() => void reload()} />
      : state.items.length === 0 ? <NoRows title={t('keys.empty')} description={t('keys.emptyDescription')} entity={t('keys.title')} />
      : <DataGrid rows={state.items} columns={columns} id={(key) => key.id} rowLabel={(key) => key.key_prefix} label={t('keys.tableLabel')} loadingLabel={t('keys.loading')} emptyTitle={t('keys.empty')} />}
    {revoking && <ConfirmTyped title={t('keys.revokeTitle')} description={t('keys.revokeDescription', { prefix: revoking.key.key_prefix })} consequences={[t('keys.revokeConsequence1'), t('keys.revokeConsequence2')]} expected={revoking.key.key_prefix} confirmLabel={t('keys.revokeConfirm')} trigger={revoking.trigger} onConfirm={() => revoke(revoking.key)} onClose={() => { const id = revoking.key.id; setRevoking(null); requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) (document.querySelector<HTMLElement>(`[data-pgdata-revoke="${id}"]`) ?? heading.current)?.focus() }) }} />}
    <Dialog open={open} modal={true} onOpenChange={(next) => { if (!next) setOpen(false) }} onOpenChangeComplete={(next) => { if (!next) { previewToken.current++; previewing.current = false; setIssued(null); setPreview({ rows: null, failure: null, busy: false }) } }}>
      <DialogContent aria-modal="true" size="lg" presentation="responsive" showClose={false} closeLabel={t('close')} container={undefined} initialFocus={true} finalFocus={() => opener.current?.isConnected ? opener.current : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="pgdata-reveal">
        <DialogHeader>
          <DialogTitle>{t('keys.revealTitle', { type: t(`keys.types.${issued?.keyType ?? 'anon'}`) })}</DialogTitle>
          <DialogDescription>{t('keys.revealDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {issued && snippetParams && <>
            <Alert tone="warning" role="status" title={t('keys.onceTitle')} description={t('keys.once')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />
            <Field invalid={false} disabled={false} className="min-w-0">
              <FieldLabel htmlFor="pgdata-issued-key">{t('keys.keyLabel')}</FieldLabel>
              <SecretField id="pgdata-issued-key" data-testid="pgdata-issued-key" value={issued.key} editable={false} defaultRevealed={false} copyable={false} showLabel={t('keys.show')} hideLabel={t('keys.hide')} aria-label={t('keys.keyLabel')} className={focusRing} />
            </Field>
            <div className="min-w-0 space-y-2" aria-label={t('keys.integration')} role="group">
              <Heading title={t('keys.fetchSnippet')} level="h3" />
              <CodeBlock code={buildFrontendSnippet(snippetParams)} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={t('keys.fetchSnippet')} className="min-w-0 max-w-full" />
              <Heading title={t('keys.curlSnippet')} level="h3" />
              <CodeBlock code={buildCurlSnippet(snippetParams)} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={t('keys.curlSnippet')} className="min-w-0 max-w-full" />
            </div>
            <div className="min-w-0 space-y-3">
              <Button type="button" variant="secondary" size="md" loading={false} disabled={preview.busy} aria-busy={preview.busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void runPreview()}>{t('keys.preview')}</Button>
              {preview.failure && <div><InlineCallout tone="destructive" title={t('errorTitle')} labels={{ title: t('errorTitle') }} description={preview.failure} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>}
              {preview.rows && <div className="min-w-0 space-y-3" aria-label={t('keys.previewRegion')} role="group" data-testid="pgdata-preview">
                <Text as="p" variant="body" tone="muted">{t('keys.previewCount', { count: preview.rows.length })}</Text>
                {preview.rows.length > 0 && <DataGrid rows={previewRows} columns={previewColumns.map((column): DataTableColumn<typeof previewRows[number]> => ({ id: column, header: column, sortable: false, accessor: (item) => formatCell(item.row[column]) }))} id={(item) => item.key} label={t('keys.previewTable')} loadingLabel={t('keys.loading')} emptyTitle={t('keys.previewEmpty')} />}
              </div>}
            </div>
          </>}
        </DialogBody>
        <DialogFooter className="flex-wrap items-center justify-end gap-3">
          <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void copyKey()}>{copied ? t('keys.copiedButton') : t('keys.copy')}</Button>
          <Button type="button" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => setOpen(false)}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
}
