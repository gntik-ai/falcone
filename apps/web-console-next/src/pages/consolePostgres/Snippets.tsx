import { useEffect, useState } from 'react'
import { CodeBlock, Text, useAnnounce } from '@gntik-ai/ui'
import { Action, Heading } from './States'
import { useCopy } from './copy'
import { postgresSnippets } from './snippets'
export function Code({ code, label }: { code: string; label: string }) {
  return <CodeBlock code={code} language="" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={(value) => value} label={label} className="min-w-0 max-w-full" />
}
export function Snippets({ name, state }: { name: string; state: string | null }) {
  const { t } = useCopy(), announce = useAnnounce()
  const [copied, setCopied] = useState<string | null>(null), [failed, setFailed] = useState<string | null>(null)
  useEffect(() => { if (copied) { const timer = window.setTimeout(() => setCopied(null), 2500); return () => window.clearTimeout(timer) } }, [copied])
  async function copy(id: string, code: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard')
      await navigator.clipboard.writeText(code); setCopied(id); setFailed(null); announce(t('snippetCopied'), 'polite')
    } catch { setCopied(null); setFailed(id); announce(t('copyFailed'), 'polite') }
  }
  return <section className="min-w-0 space-y-4" aria-label={t('snippets')}><Heading title={t('snippets')} description={t('snippetsDescription')} level="h3" />
    {postgresSnippets(name).map((entry, index) => <article key={entry.id} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><Heading title={t(entry.label)} level="h3" /><Action onClick={() => void copy(entry.id, entry.code)}>{t(copied === entry.id ? 'copied' : 'copy')}</Action></div>
      <Code code={entry.code} label={t(entry.label)} />
      {failed === entry.id && <Text as="p" variant="body" tone="muted">{t('copyFailed')}</Text>}
      {copied === entry.id && <Text as="p" variant="body" tone="muted">{t('snippetCopied')}</Text>}
      {index === 0 && <Text as="p" variant="body" tone="muted">{t('snippetEndpoint')}</Text>}
      {state !== 'active' && <Text as="p" variant="body" tone="muted">{t('snippetExternal')}</Text>}
      {state && ['provisioning', 'pending', 'error', 'degraded', 'failed'].includes(state.toLowerCase()) && <Text as="p" variant="body" tone="muted">{t('snippetState', { state })}</Text>}
      <Text as="p" variant="body" tone="muted">{t('secrets')} {t('secretReference')}</Text>
    </article>)}
  </section>
}
