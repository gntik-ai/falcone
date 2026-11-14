import { useEffect, useRef, useState } from 'react'
import { Alert, CodeBlock, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, SecretField, useAnnounce } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import { buildCurlSnippet, buildFrontendSnippet, collectColumns, copyToClipboard, failureOf, formatCell, previewRowsWithApiKey, type IssuedApiKey, type PgRow, type Target } from './api'
import { focusRing, useCopy } from './copy'
import { Action, Heading, Table } from './States'

function Code({ code, label }: { code: string; label: string }) {
  return <CodeBlock code={code} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={label} className="min-w-0 max-w-full" />
}

// One-time reveal of an issued key (gap-b004-api-key-issue-dialog). The key lives only in this
// component's props and state: it is never written to storage, a toast or a live region, and
// closing the dialog drops it.
export function RevealDialog({ issued, target, opener, close }: { issued: IssuedApiKey; target: Target; opener: HTMLElement | null; close: () => void }) {
  const { t } = useCopy(), announce = useAnnounce()
  const [copied, setCopied] = useState(false), [previewBusy, setPreviewBusy] = useState(false)
  const [previewRows, setPreviewRows] = useState<PgRow[] | null>(null), [previewError, setPreviewError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null), running = useRef(false), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  async function copy() {
    const ok = await copyToClipboard(issued.key)
    setCopied(ok); announce(ok ? t('keyCopied') : t('copyFailed'), 'polite')
  }
  async function preview() {
    if (running.current) return
    running.current = true; setPreviewError(null); setPreviewBusy(true)
    try {
      const result = await previewRowsWithApiKey(issued.key, target, { pageSize: 10 })
      if (live.current) setPreviewRows(result.items)
    } catch (cause) { if (live.current) setPreviewError(failureOf(cause).message ?? t('mutationFailed')) }
    finally { running.current = false; if (live.current) setPreviewBusy(false) }
  }
  const columns = previewRows ? collectColumns(previewRows) : []
  return <Dialog open={true} modal={true} onOpenChange={(next) => { if (!next) close() }}>
    <DialogContent ref={panel} aria-modal="true" size="lg" presentation="responsive" showClose={false} closeLabel={t('close')} container={undefined} initialFocus={() => panel.current ?? true}
      finalFocus={() => opener?.isConnected ? opener : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="pgdata-reveal">
      <DialogHeader><DialogTitle>{t(issued.keyType === 'service' ? 'revealTitleService' : 'revealTitleAnon')}</DialogTitle><DialogDescription>{t('revealDescription')}</DialogDescription></DialogHeader>
      <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <Alert tone="warning" role="status" title={t('shownOnceTitle')} description={t('shownOnce')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />
        <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pgdata-issued-key">{t('keyLabel')}</FieldLabel>
          <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="pgdata-secret">
            <div className="min-w-0 flex-1 basis-60"><SecretField id="pgdata-issued-key" value={issued.key} editable={false} defaultRevealed={false} copyable={false} showLabel={t('showKey')} hideLabel={t('hideKey')} aria-label={t('keyLabel')} className={focusRing} /></div>
            <Action onClick={() => void copy()}>{t(copied ? 'copiedKey' : 'copyKey')}</Action>
          </div>
        </Field>
        <section aria-label={t('snippetsLabel')} className="min-w-0 space-y-3" data-testid="pgdata-snippets">
          <Heading title={t('snippetFetch')} level="h3" /><Code code={buildFrontendSnippet(issued.key, target, origin)} label={t('snippetFetch')} />
          <Heading title={t('snippetCurl')} level="h3" /><Code code={buildCurlSnippet(issued.key, target, origin)} label={t('snippetCurl')} />
        </section>
        <div className="flex flex-wrap items-center gap-2"><Action disabled={previewBusy} busy={previewBusy} onClick={() => void preview()}>{t('previewRun')}</Action></div>
        {previewError && <div role="alert"><InlineCallout tone="destructive" title={t('previewErrorTitle')} description={previewError} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} /></div>}
        {previewRows && <section aria-label={t('previewHeading')} className="min-w-0 space-y-3" data-testid="pgdata-preview">
          <p className="text-sm text-muted-foreground">{t('previewSummary', { count: previewRows.length })}</p>
          <Table rows={previewRows} label={t('previewTableLabel')} id={(row, index) => typeof row.id === 'string' ? `${row.id}-${index}` : String(index)} columns={columns.map((column) => ({ id: column, header: column, sortable: false, cell: (row: PgRow) => formatCell(row[column]) }))} />
        </section>}
      </DialogBody>
      <DialogFooter className="flex-wrap items-center justify-end gap-2.5"><Action variant="primary" onClick={close}>{t('close')}</Action></DialogFooter>
    </DialogContent>
  </Dialog>
}
