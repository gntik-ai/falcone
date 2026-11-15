import { useEffect, useRef, useState } from 'react'
import { Alert, Button, CodeBlock, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, JsonViewer, SecretField, Text, useAnnounce } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import { buildCurlSnippet, buildFrontendSnippet, copyToClipboard, documentId, failureOf, issueAnonKey, previewDocumentsWithApiKey, type IssuedApiKey, type MongoDocument, type Target } from './api'
import { focusRing, useCopy } from './copy'
import { Heading } from './parts'

type Preview = { docs: MongoDocument[] | null; failure: string | null; busy: boolean }
const idle: Preview = { docs: null, failure: null, busy: false }

// The plaintext key lives in this component's state only. It is never written to storage, a toast or an announcement,
// and it is dropped as soon as the reveal dialog closes or the page unmounts.
export function KeyPanel({ target, onError }: { target: Target; onError: (message: string | null) => void }) {
  const { t } = useCopy(), announce = useAnnounce()
  const [issued, setIssued] = useState<IssuedApiKey | null>(null), [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [snippetCopied, setSnippetCopied] = useState<'fetch' | 'curl' | null>(null), [preview, setPreview] = useState<Preview>(idle), [issuing, setIssuing] = useState(false)
  const opener = useRef<HTMLElement | null>(null), issuingRef = useRef(false), previewToken = useRef(0), previewing = useRef(false), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; previewToken.current++ } }, [])

  async function issue(button: HTMLElement) {
    if (issuingRef.current) return
    issuingRef.current = true; setIssuing(true); onError(null)
    try {
      const key = await issueAnonKey(target.workspaceId)
      if (!live.current) return
      previewToken.current++; previewing.current = false
      opener.current = button; setIssued(key); setOpen(true); setCopied(false); setSnippetCopied(null); setPreview(idle)
      announce(t('keys.issuedAnnounce'), 'polite')
    } catch (cause) { if (live.current) onError(failureOf(cause).message ?? t('requestFailed')) }
    finally { issuingRef.current = false; if (live.current) setIssuing(false) }
  }
  async function runPreview() {
    if (!issued || previewing.current) return
    previewing.current = true
    const mine = ++previewToken.current
    setPreview({ docs: null, failure: null, busy: true })
    try {
      const result = await previewDocumentsWithApiKey(issued.key, target, { pageSize: 10 })
      if (mine === previewToken.current) setPreview({ docs: result.items ?? [], failure: null, busy: false })
    } catch (cause) {
      // A preview 401 is a local error: the key is rejected, the console session is untouched.
      if (mine === previewToken.current) setPreview({ docs: null, failure: failureOf(cause).message ?? t('requestFailed'), busy: false })
    } finally { if (mine === previewToken.current) previewing.current = false }
  }
  async function copyKey() {
    if (!issued) return
    const ok = await copyToClipboard(issued.key)
    setCopied(ok); announce(t(ok ? 'keys.copied' : 'copyFailed'), 'polite')
  }
  // The snippets embed the key, so the announcement names the snippet and never repeats its text.
  async function copySnippet(kind: 'fetch' | 'curl', text: string) {
    const ok = await copyToClipboard(text)
    setSnippetCopied(ok ? kind : null); announce(t(ok ? 'keys.snippetCopied' : 'copyFailed'), 'polite')
  }
  const snippetParams = issued ? { apiKey: issued.key, ...target, origin: typeof window !== 'undefined' ? window.location.origin : undefined } : null
  const viewerLabels = { copyPath: t('json.copyPath'), copyValue: t('json.copyValue'), copied: t('json.copied'), copyFailed: t('json.copyFailed'), selectHint: t('json.selectHint'), truncated: t('json.truncated'), copyFullHint: t('json.copyFullHint'), keys: (count: number) => t('json.keys', { count }), items: (count: number) => t('json.items', { count }), root: t('json.root') }
  return <section aria-label={t('keys.title')} className="min-w-0 space-y-4" data-testid="mongodata-keys">
    <Heading title={t('keys.title')} description={t('keys.description')} />
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="primary" size="md" loading={false} disabled={issuing} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={(event) => void issue(event.currentTarget)}>{t('keys.issueAnon')}</Button>
    </div>
    <Dialog open={open} modal={true} onOpenChange={(next) => { if (!next) setOpen(false) }} onOpenChangeComplete={(next) => { if (!next) { previewToken.current++; previewing.current = false; setIssued(null); setSnippetCopied(null); setPreview(idle) } }}>
      <DialogContent aria-modal="true" size="lg" presentation="responsive" showClose={false} closeLabel={t('close')} container={undefined} initialFocus={true} finalFocus={() => opener.current?.isConnected ? opener.current : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="mongodata-reveal">
        <DialogHeader>
          <DialogTitle>{t('keys.revealTitle')}</DialogTitle>
          <DialogDescription>{t('keys.revealDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {issued && snippetParams && <>
            <Alert tone="warning" role="status" title={t('keys.onceTitle')} description={t('keys.once')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />
            <Field invalid={false} disabled={false} className="min-w-0">
              <FieldLabel htmlFor="mongodata-issued-key">{t('keys.keyLabel')}</FieldLabel>
              <SecretField id="mongodata-issued-key" data-testid="mongodata-issued-key" value={issued.key} editable={false} defaultRevealed={false} copyable={false} showLabel={t('keys.show')} hideLabel={t('keys.hide')} aria-label={t('keys.keyLabel')} className={focusRing} />
            </Field>
            <div className="min-w-0 space-y-2" aria-label={t('keys.integration')} role="group">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Heading title={t('keys.fetchSnippet')} level="h3" />
                <Button type="button" variant="secondary" size="sm" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} data-testid="mongodata-copy-fetch" aria-label={t('keys.copyFetch')} onClick={() => void copySnippet('fetch', buildFrontendSnippet(snippetParams))}>{snippetCopied === 'fetch' ? t('keys.snippetCopied') : t('keys.copySnippet')}</Button>
              </div>
              <CodeBlock code={buildFrontendSnippet(snippetParams)} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={t('keys.fetchSnippet')} className="min-w-0 max-w-full" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Heading title={t('keys.curlSnippet')} level="h3" />
                <Button type="button" variant="secondary" size="sm" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} data-testid="mongodata-copy-curl" aria-label={t('keys.copyCurl')} onClick={() => void copySnippet('curl', buildCurlSnippet(snippetParams))}>{snippetCopied === 'curl' ? t('keys.snippetCopied') : t('keys.copySnippet')}</Button>
              </div>
              <CodeBlock code={buildCurlSnippet(snippetParams)} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={t('keys.curlSnippet')} className="min-w-0 max-w-full" />
            </div>
            <div className="min-w-0 space-y-3">
              <Button type="button" variant="secondary" size="md" loading={false} disabled={preview.busy} aria-busy={preview.busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void runPreview()}>{t('keys.preview')}</Button>
              {preview.failure && <div data-testid="mongodata-preview-error"><InlineCallout tone="destructive" title={t('errorTitle')} labels={{ title: t('errorTitle') }} description={preview.failure} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>}
              {preview.docs && <div className="min-w-0 space-y-3" aria-label={t('keys.previewRegion')} role="group" data-testid="mongodata-preview">
                <Text as="p" variant="body" tone="muted">{t('keys.previewCount', { count: preview.docs.length })}</Text>
                {preview.docs.map((doc, index) => <div key={`${documentId(doc) ?? 'doc'}-${index}`} data-mongodata-data="" className="min-w-0"><JsonViewer data={doc} label={t('keys.previewDocument', { n: index + 1 })} defaultExpandDepth={1} maxDepth={undefined} search="" toolbar={false} maxHeight={200} maxDisplayChars={undefined} emptyContent={undefined} labels={viewerLabels} className="min-w-0" /></div>)}
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
