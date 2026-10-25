import { useEffect, useRef, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Badge, I18nProvider, LiveAnnouncer, Select, SelectContent, SelectItem, SelectTrigger, SettingsLayout, Skeleton, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, NotFoundEmpty, PageHeader, SettingsRow, type ErrorPanelLabels } from '@gntik-ai/blocks'
import { Settings as SettingsIcon } from 'lucide-react'
import i18n from '../i18n'
import { createLocaleBundleLoader, loadLocale, registerLocaleBundles, retryLocale, useLocaleLoader } from '../i18n/locale-loader'
import { useConsoleContext } from '../shell/context'
import { ShellErrorBoundary } from '../shell/RouteState'
import es from '../locales/es/pages.console-settings-page.json'
import en from '../locales/en/pages.console-settings-page.json'

i18n.addResourceBundle('es', 'pages.console-settings-page', es)
i18n.addResourceBundle('en', 'pages.console-settings-page', en)

// Raw imports produce independent locale chunks even though initial copy is in this route.
const imports = {
  es: () => import('../locales/es/pages.console-settings-page.json?raw'),
  en: () => import('../locales/en/pages.console-settings-page.json?raw'),
}
const resourceUrls = import.meta.glob<string>('../locales/*/pages.console-settings-page.json', { query: '?url&no-inline', import: 'default', eager: true })
const loaders = {
  es: createLocaleBundleLoader(imports.es, resourceUrls['../locales/es/pages.console-settings-page.json']),
  en: createLocaleBundleLoader(imports.en, resourceUrls['../locales/en/pages.console-settings-page.json']),
}

function SettingsContent() {
  const { t } = useTranslation('pages.console-settings-page')
  const context = useConsoleContext()
  const navigate = useNavigate()
  const locale = useLocaleLoader()
  const announce = useAnnounce()
  const trigger = useRef<HTMLButtonElement>(null)
  const retryFocus = useRef(false)
  const selectionFocus = useRef(false)
  const focusFrame = useRef<number | null>(null)
  const previous = useRef(locale)
  useEffect(() => registerLocaleBundles('pages.console-settings-page', loaders), [])
  useEffect(() => () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
  }, [])
  useEffect(() => {
    if (locale.pending && focusFrame.current !== null) {
      cancelAnimationFrame(focusFrame.current)
      focusFrame.current = null
    }
    if (locale.target && !locale.pending && previous.current.revision !== locale.revision) {
      if (locale.error) announce(t('error.announcement'), 'assertive')
      else announce(t('language.changed', { language: t(`language.${i18n.language}`) }))
      if ((!locale.error && retryFocus.current) || selectionFocus.current) {
        // Let the kit propagate its enabled state before focusing the trigger.
        focusFrame.current = requestAnimationFrame(() => {
          focusFrame.current = null
          trigger.current?.focus()
        })
      }
      selectionFocus.current = false
      retryFocus.current = false
    }
    previous.current = locale
  }, [locale, t, announce])
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)?.displayName ?? t('tenantFallback')
  const labels = t('labels', { returnObjects: true }) as ErrorPanelLabels
  return <SettingsLayout groups={[{ items: [
    { id: 'profile', label: t('nav.profile'), href: '/console/profile' },
    { id: 'settings', label: t('nav.settings'), href: '/console/settings', current: true },
  ] }]} value="settings" onValueChange={(_, item) => {
    if (item.href === '/console/profile') window.location.assign(item.href)
    else if (item.href) navigate(item.href)
  }}
    navLabel={t('nav.label')} selectLabel={t('nav.label')} skipLinkLabel={t('nav.settings')}
    title={null} description={null} saveBar="none" embedded fullScreen={false} width="wide" mainId="console-settings"
    header={<div className="flex items-start gap-3"><div className="min-w-0 flex-1"><PageHeader as="div" breadcrumbs={null} title={t('title')} wrapTitle
      description={context.loading ? null : t('description', { tenant })}
      status="" statuses={{}} meta={[]} actions={[]} tabs={null} />{context.loading && <div role="status" aria-label={t('loading')}><Skeleton className="mt-2 h-5 w-full" /></div>}</div><Badge variant="soft">{t('badge')}</Badge></div>}>
    <div className="space-y-6 min-w-0">
      <SettingsRow label={t('language.label')} description={t('language.description')}
        className="flex-col sm:flex-row" disabled={false} children={null}
        control={({ labelId, descriptionId }) => <Select value={i18n.language} disabled={locale.pending}
          items={[{ value: 'es', label: t('language.es') }, { value: 'en', label: t('language.en') }]}
          onValueChange={(value) => { if (value === 'es' || value === 'en') { selectionFocus.current = true; void loadLocale(value) } }}>
          <SelectTrigger ref={trigger} aria-labelledby={labelId} aria-describedby={descriptionId} aria-busy={locale.pending} placeholder={t('language.label')} />
          <SelectContent><SelectItem value="es">{t('language.es')}</SelectItem><SelectItem value="en">{t('language.en')}</SelectItem></SelectContent>
        </Select>} />
      {locale.error && <ErrorPanel title={t('error.title')} message={t('error.message')} labels={labels}
        code={null} requestId="" details="" retryLabel={t('error.retry')} retrying={locale.pending}
        secondaryAction={null} titleAs="h2" announce={false}
        onRetry={async () => { retryFocus.current = true; await retryLocale() }} />}
      <NotFoundEmpty icon={SettingsIcon as ComponentProps<typeof NotFoundEmpty>['icon']} title={t('empty.title')} titleAs="h2" bordered={false}
        description={<><span>{t('empty.description')}</span><span className="mt-4 block">{t('empty.body')}</span></>} action={null} />
    </div>
  </SettingsLayout>
}

export default function Settings() {
  const { t, i18n: language } = useTranslation('pages.console-settings-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer>
    <ShellErrorBoundary title={t('title')} message={t('error.renderMessage')} errorLabels={t('labels', { returnObjects: true }) as ErrorPanelLabels}>
      <SettingsContent />
    </ShellErrorBoundary>
  </LiveAnnouncer></I18nProvider>
}
