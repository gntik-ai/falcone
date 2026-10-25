import { Component, type ReactNode } from 'react'
import { Button, StatusLayout } from '@gntik-ai/ui'
import { ErrorPanel, type ErrorPanelLabels } from '@gntik-ai/blocks'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

export function RouteState({ state, retry, title, description, message, errorLabels }: { message?: string; errorLabels?: ErrorPanelLabels; title?: string; description?: string; state: 'forbidden' | 'notFound' | 'unknown' | 'serverError'; retry?: () => void }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  return <StatusLayout mainId="route-status" code={state === 'forbidden' ? '403' : state === 'serverError' ? '500' : '404'}
    title={title ?? t(`states.${state}.title`)} description={description ?? message ?? t(`states.${state}.body`)}
    primaryAction={<Button onClick={() => navigate('/console/overview')}>{t('navigation.overview')}</Button>}
    secondaryAction={<Button variant="ghost" onClick={() => navigate(-1)}>{t('shell.back')}</Button>}>
    {state === 'serverError' && <ErrorPanel title={title ?? t('states.serverError.title')} message={message ?? t('states.serverError.body')}
      labels={errorLabels} requestId="" code={500} details="" secondaryAction={null}
      retryLabel={errorLabels?.retry ?? t('shell.retry')} onRetry={retry} />}
  </StatusLayout>
}

export class ShellErrorBoundary extends Component<{ children: ReactNode; title?: string; message?: string; errorLabels?: ErrorPanelLabels }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <RouteState state="serverError" title={this.props.title} message={this.props.message} errorLabels={this.props.errorLabels} retry={() => this.setState({ failed: false })} /> : this.props.children
  }
}
