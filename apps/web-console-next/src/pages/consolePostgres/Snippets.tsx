import { useEffect, useState } from 'react'
import { Text, useAnnounce } from '@gntik-ai/ui'
import { Action, Code, Heading } from './Parts'
import { snippetTemplates } from './snippets'
import { useCopy } from './copy'

export function Snippets({ database, state }: { database: string; state: string | null }) {
  const { t } = useCopy(), announce = useAnnounce()
  const [feedback, setFeedback] = useState<{ index: number; key: string } | null>(null)
  useEffect(() => {
    if (feedback?.key !== 'snippetCopied') return
    const timer = window.setTimeout(() => setFeedback(null), 2500)
    return () => window.clearTimeout(timer)
  }, [feedback])
  return <section aria-label={t('snippets')} className="min-w-0 space-y-4"><Heading title={t('snippets')} description={t('snippetsDescription')} level="h3" />
    {snippetTemplates.map((template, index) => {
      const code = template.replaceAll('{PASSWORD}', '<YOUR_SECRET>').replaceAll('{HOST}', '<RESOURCE_HOST>').replaceAll('{PORT}', '5432').replaceAll('{RESOURCE_NAME}', database)
      return <div key={index} className="min-w-0 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><Heading title={t(`snippetLabel${index}`)} description="" level="h3" /><Action onClick={async () => {
        try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(code); setFeedback({ index, key: 'snippetCopied' }); announce(t('snippetCopied'), 'polite') }
        catch { setFeedback({ index, key: 'clipboardUnavailable' }); announce(t('clipboardUnavailable'), 'polite') }
      }}>{t(feedback?.index === index && feedback.key === 'snippetCopied' ? 'copied' : 'copy')}</Action></div>
        <Code code={code} label={t(`snippetLabel${index}`)} language={['text', 'js', 'python'][index]} />
        {feedback?.index === index && <Text as="p" variant="supporting" tone="muted">{t(feedback.key)}</Text>}
        <ul className="list-disc pl-5 text-sm text-muted-foreground">{index === 0 && <li>{t('snippetEndpoint')}</li>}{state !== 'active' && <li>{t('snippetExternal')}</li>}{state && ['provisioning', 'pending', 'error', 'degraded', 'failed'].includes(state.toLowerCase()) && <li>{t('snippetState', { state })}</li>}</ul>
        <Text as="p" variant="supporting" tone="muted">{t('snippetSecrets')} {t('snippetSecretRef')}</Text>
      </div>
    })}
  </section>
}
