import { useEffect, useRef } from 'react'
import { Button, Logo, StatusLayout, Text } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { hasUsableConsoleSession, readConsoleShellSession } from '@in-falcone/console-api/session'
import i18n from '../i18n'
import es from '../locales/es/pages.not-found-page.json'
import en from '../locales/en/pages.not-found-page.json'

i18n.addResourceBundle('es', 'pages.not-found-page', es)
i18n.addResourceBundle('en', 'pages.not-found-page', en)

export default function NotFoundPage() {
  const { t } = useTranslation('pages.not-found-page')
  const navigate = useNavigate()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const authenticated = hasUsableConsoleSession(readConsoleShellSession())
  // Only router entries within this document offer a safe history recovery action.
  const historyIndex = typeof window === 'undefined' ? undefined : window.history.state?.idx
  const canGoBack = typeof historyIndex === 'number' && historyIndex > 0

  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('documentTitle')
    return () => { document.title = previousTitle }
  }, [t])

  return <StatusLayout mainId="not-found-main" tone="neutral" fullScreen={false} className="min-w-0"
    header={<Logo size={24} wordmark={true} aria-label={t('logo')} />} footer={null}
    skipLinkLabel={t('skip')} titleRef={undefined} icon={undefined} illustration={null}
    code={<Text as="span" variant="supporting" tone="muted" truncate={false} lineClamp={undefined} className="tracking-normal">{t('code')}</Text>}
    heading={<PageHeader as="div" title={t('title')} titleRef={titleRef} wrapTitle={true}
      description={t('description')} breadcrumbs={null} meta={[]} tabs={null} actions={[]}
      status="" statuses={{}} tab={undefined} defaultTab={undefined} onTabChange={undefined}
      labels={{ title: t('title'), description: t('description'), moreActions: t('moreActions'), sections: t('sections') }} className="" />}
    description={null}
    primaryAction={<Button render={<RouterLink to={authenticated ? '/console' : consoleAuthConfig.loginPath} />}
      nativeButton={false} role="link" variant="primary" size="md" loading={false} disabled={false}
      iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full sm:w-auto">
      {t(authenticated ? 'console' : 'login')}<ArrowRight size={16} aria-hidden="true" />
    </Button>}
    secondaryAction={<>
      <Button render={<RouterLink to="/" />} nativeButton={false} role="link" variant="secondary" size="md"
        loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full sm:w-auto">
        {t('home')}
      </Button>
      {canGoBack ? <Button type="button" nativeButton={true} variant="ghost" size="md" loading={false} disabled={false}
        iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full sm:w-auto" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} aria-hidden="true" />{t('back')}
      </Button> : null}
    </>} children={null} />
}
