import { useEffect, useState } from 'react'
import { CodeBlock, Text } from '@gntik-ai/ui'
import type { StorageBucket } from './api'
import { storageSnippets } from './snippets'
import { useCopy } from './copy'
import { Action, Heading } from './States'

export function Snippets({ bucket }: { bucket: StorageBucket }) {
  const { t } = useCopy()
  const [feedback, setFeedback] = useState<{ id: string; key: string } | null>(null)
  useEffect(() => {
    if (feedback?.key !== 'snippetCopied') return
    const timer = window.setTimeout(() => setFeedback(null), 2500)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const state = bucket.provisioning?.state ?? bucket.status
  const warning = state && ['provisioning', 'pending', 'error', 'degraded', 'failed'].includes(state.toLowerCase())
  return <section className="min-w-0 space-y-4" aria-label={t('snippets')}>
    <Heading title={t('snippets')} description={t('snippetsDescription')} level="h3" />
    {storageSnippets(bucket).map((entry, index) => <div key={entry.id} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><Heading title={t(entry.label)} level="h3" /><Action onClick={async () => {
        try { if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(entry.code); setFeedback({ id: entry.id, key: 'snippetCopied' }) }
        catch { setFeedback({ id: entry.id, key: 'clipboardUnavailable' }) }
      }}>{t(feedback?.id === entry.id && feedback.key === 'snippetCopied' ? 'copied' : 'copy')}</Action></div>
      <CodeBlock code={entry.code} language={['bash', 'js', 'python', 'bash'][index]} filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined} label={t(entry.label)} className="min-w-0" />
      <div aria-live="polite">{feedback?.id === entry.id && <Text as="p" variant="supporting" tone="muted">{t(feedback.key)}</Text>}</div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {index === 0 && <li>{t('snippetEndpoint')}</li>}{index === 3 && <li>{t('snippetPresign')}</li>}
        {state !== 'active' && <li>{t('snippetExternal')}</li>}{warning && <li>{t('snippetState', { state })}</li>}<li>{t('snippetMissing')}</li>
      </ul>
      {index < 3 && <Text as="p" variant="supporting" tone="muted">{t('snippetSecrets')} {t('snippetSecretRef')}</Text>}
    </div>)}
  </section>
}
