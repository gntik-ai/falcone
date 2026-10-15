import { useEffect } from 'react'
import { useAnnounce } from '@gntik-ai/ui'
import { useTranslation } from 'react-i18next'

export type StatusState = 'loading' | 'empty' | 'unauthorized' | 'forbidden' | 'notFound' | 'serverError' | 'network'

export function StatusPage({ state }: { state: StatusState }) {
  const { t } = useTranslation('common')
  const announce = useAnnounce()
  const title = t(`states.${state}.title`)
  const body = t(`states.${state}.body`)
  useEffect(() => { announce(`${title}. ${body}`) }, [announce, title, body])
  return <section aria-busy={state === 'loading'}>
    <h1 className="text-2xl font-semibold">{title}</h1>
    <p className="mt-2 text-muted-foreground">{body}</p>
  </section>
}
