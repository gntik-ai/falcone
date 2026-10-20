import { useEffect, useState } from 'react'
import { Button } from '@gntik-ai/ui'
import { useTranslation } from 'react-i18next'
import { StatusPage } from '../../StatusPage'
import { useSession } from '../session'

export default function PageEndpoint() {
  const { t } = useTranslation('common')
  const session = useSession()
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<'loading' | 'serverError' | 'success'>('loading')
  const [data, setData] = useState<{ title: string } | null>(null)
  useEffect(() => {
    let active = true
    setState('loading')
    void fetch('/v1/synthetic-page').then(async (response) => {
      if (!response.ok) throw new Error('synthetic-page-failure')
      return response.json() as Promise<{ title: string }>
    }).then((value) => { if (active) { setData(value); setState('success') } })
      .catch(() => { if (active) setState('serverError') })
    return () => { active = false }
  }, [attempt])
  return state === 'success' ? <section><h1>{data!.title}</h1><p>{session?.principal?.platformRoles?.join(', ')}</p></section>
    : <><StatusPage state={state} />{state === 'serverError' && <Button onClick={() => retry((value) => value + 1)}>{t('shell.retry')}</Button>}</>
}
