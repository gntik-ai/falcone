import { useEffect } from 'react'
import { AuthLayout, Badge, Button, Card, CardBody, CardHeader, CardTitle, Grid, Link, Logo, Separator, Text } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { ArrowRight, KeyRound } from 'lucide-react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import i18n from '../i18n'
import es from '../locales/es/pages.welcome-page.json'
import en from '../locales/en/pages.welcome-page.json'

i18n.addResourceBundle('es', 'pages.welcome-page', es)
i18n.addResourceBundle('en', 'pages.welcome-page', en)

export default function WelcomePage() {
  const { t } = useTranslation('pages.welcome-page')
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('documentTitle')
    return () => { document.title = previousTitle }
  }, [t])
  // The shared config has a Spanish default; only an explicit override bypasses translation.
  const recovery = consoleAuthConfig.labels.passwordRecovery === es.recovery
    ? t('recovery') : consoleAuthConfig.labels.passwordRecovery

  return <AuthLayout variant="full-bleed" mainId="welcome-main" fullScreen={false}
    logo={<Logo size={28} wordmark={true} aria-label={t('logo')} />}
    brand={null} brandFooter={null} brandLabel={t('logo')} footer={null} skipLinkLabel={t('skip')}
    className="welcome-layout min-w-0">
    <div className="mb-6"><Link render={<RouterLink to={consoleAuthConfig.loginPath} />} tone="muted" underline="always" external={false} externalLabel="">{t('back')}</Link></div>
    <section aria-labelledby="welcome-title" className="space-y-6 min-w-0 wrap-anywhere">
      <Badge tone="neutral" variant="soft" size="auto" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('badge')}</Badge>
      <PageHeader as="div" breadcrumbs={null} title={t('title')} wrapTitle={true}
        titleRef={(heading) => { if (heading) heading.id = 'welcome-title' }} description={t('intro')}
        status="" statuses={{}} meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined}
        labels={{ title: t('title'), description: t('intro'), moreActions: t('moreActions'), sections: t('sections') }} className="" />
      <Grid as="div" cols={{ base: 1, sm: 2 }} minChildWidth={undefined} gap={4} rowGap={4} align="stretch" flow="row" className="welcome-cards min-w-0">
        {(['secure', 'signup'] as const).map((card) => <Card key={card} variant="default" className="min-w-0">
          <CardHeader divided={false}><CardTitle as="h2">{t(`${card}Title`)}</CardTitle></CardHeader>
          <CardBody><Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t(`${card}Body`)}</Text></CardBody>
        </Card>)}
      </Grid>
      <div className="space-y-3">
        <div className="welcome-actions flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button render={<RouterLink to={consoleAuthConfig.loginPath} />} nativeButton={false} role="link" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined}>
            {t('login')}<KeyRound size={16} aria-hidden="true" />
          </Button>
          <Button render={<RouterLink to={consoleAuthConfig.signupPath} />} nativeButton={false} role="link" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined}>
            {t('signup')}<ArrowRight size={16} aria-hidden="true" />
          </Button>
        </div>
        <Link render={<RouterLink to={consoleAuthConfig.passwordRecoveryPath} />} tone="primary" underline="always" external={false} externalLabel="">{recovery}</Link>
      </div>
      <Separator orientation="horizontal" label={null} labelPosition="center" />
      <Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('help')}</Text>
    </section>
  </AuthLayout>
}
