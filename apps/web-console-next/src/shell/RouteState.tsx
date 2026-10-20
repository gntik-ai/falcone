import { Component, type ReactNode } from 'react'
import { Button, StatusLayout } from '@gntik-ai/ui'
import { ErrorPanel } from '@gntik-ai/blocks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

export function RouteState({ state, retry, denialTitle, denialDescription }: { state: 'forbidden' | 'notFound' | 'unknown' | 'serverError'; retry?: () => void; denialTitle?: string; denialDescription?: string }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  return <StatusLayout mainId="route-status" code={state === 'forbidden' ? '403' : state === 'serverError' ? '500' : '404'}
    title={state === 'forbidden' ? denialTitle ?? t('states.forbidden.title') : t(`states.${state}.title`)}
    description={state === 'forbidden' ? denialDescription ?? t('states.forbidden.body') : t(`states.${state}.body`)}
    primaryAction={<Button onClick={() => navigate('/console/overview')}>{t('navigation.overview')}</Button>}
    secondaryAction={<Button variant="ghost" onClick={() => navigate(-1)}>{t('shell.back')}</Button>}>
    {state === 'serverError' && <ErrorPanel title={t('states.serverError.title')} message={t('states.serverError.body')}
      retryLabel={t('shell.retry')} onRetry={retry} />}
  </StatusLayout>
}

export class ShellErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <RouteState state="serverError" retry={() => this.setState({ failed: false })} /> : this.props.children
  }
}
