import { useEffect, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Badge, I18nProvider, Link, SettingsLayout } from '@gntik-ai/ui'
import { DescriptionListCard, ErrorPanel, ListSkeleton, NoAccessEmpty, NoResultsEmpty, NotFoundEmpty, PageHeader, SectionHeader, TableSkeleton, type DescriptionItem } from '@gntik-ai/blocks'
import { SearchX, ServerCrash } from 'lucide-react'
import i18n from '../i18n'
import { createLocaleBundleLoader, registerLocaleBundles } from '../i18n/locale-loader'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { useSession } from '../shell/session'
import es from '../locales/es/pages.console-profile-page.json'
import en from '../locales/en/pages.console-profile-page.json'

i18n.addResourceBundle('es', 'pages.console-profile-page', es)
i18n.addResourceBundle('en', 'pages.console-profile-page', en)
const imports = {
  es: () => import('../locales/es/pages.console-profile-page.json?raw'),
  en: () => import('../locales/en/pages.console-profile-page.json?raw'),
}
const resourceUrls = import.meta.glob<string>('../locales/*/pages.console-profile-page.json', { query: '?url&no-inline', import: 'default', eager: true })
const loaders = {
  es: createLocaleBundleLoader(imports.es, resourceUrls['../locales/es/pages.console-profile-page.json']),
  en: createLocaleBundleLoader(imports.en, resourceUrls['../locales/en/pages.console-profile-page.json']),
}

// Translate the shared permission model's selected label without re-ranking roles.
const roleKeys: Record<string, keyof typeof es.roles.labels> = {
  Superadmin: 'superadmin',
  'Admin de plataforma': 'platform_admin',
  'Operador de plataforma': 'platform_operator',
  'Equipo de plataforma': 'platform_team',
  Propietario: 'tenant_owner',
  Administrador: 'tenant_admin',
  'Propietario de área de trabajo': 'workspace_owner',
  'Administrador de área de trabajo': 'workspace_admin',
  'Developer · solo lectura': 'tenant_developer',
  'Viewer · solo lectura': 'tenant_viewer',
  'Sin rol asignado': 'none',
  'Rol sin permisos de escritura reconocidos': 'unknown',
}

export default function ConsoleProfile() {
  const { t, i18n: language } = useTranslation('pages.console-profile-page')
  const session = useSession()
  const permissions = usePermissions()
  const context = useConsoleContext()
  const navigate = useNavigate()
  useEffect(() => registerLocaleBundles('pages.console-profile-page', loaders), [])

  const principal = session?.principal
  const title = principal?.displayName?.trim() || principal?.username?.trim() || principal?.primaryEmail?.trim() || t('principalFallback')
  const secondary = principal?.primaryEmail?.trim() || principal?.username?.trim() || t('secondaryFallback')
  const highestRole = t(`roles.labels.${roleKeys[permissions.highestRoleLabel] ?? 'unknown'}`)
  const item = (id: string, label: string, value: string, render: DescriptionItem['render'] = undefined): DescriptionItem => ({
    id, label, value, render, status: undefined, mono: false, copyable: false, copyValue: '',
  })
  const items = [
    item('username', t('fields.username'), principal?.username ?? t('missingIdentity')),
    item('email', t('fields.email'), principal?.primaryEmail ?? t('missingIdentity')),
    item('role', t('fields.role'), highestRole, <Badge variant="outline" className="whitespace-normal wrap-anywhere">{highestRole}</Badge>),
    ...(context.error ? [] : [
      item('tenant', t('fields.tenant'), context.tenants.find((tenant) => tenant.tenantId === context.activeTenantId)?.displayName ?? t('missingContext')),
      item('workspace', t('fields.workspace'), context.workspaces.find((workspace) => workspace.workspaceId === context.activeWorkspaceId)?.displayName ?? t('missingContext')),
    ]),
  ]
  const contextError = context.error?.status === 403
    ? <NoAccessEmpty resource="" owner="" showRequestAccess={false} defaultRequested={false} onRequestAccess={undefined}
      action={{ label: t('context.back'), href: '/console' }} titleAs="h2" bordered={false} className="min-w-0"
      labels={{ title: () => t('context.noAccessTitle'), description: () => t('context.noAccessDescription'), request: '', requested: '', sent: '' }} />
    : context.error?.status === 404
      ? <NotFoundEmpty icon={SearchX as ComponentProps<typeof NotFoundEmpty>['icon']} title={t('context.notFoundTitle')} description={t('context.notFoundDescription')}
        action={<Link href="/console" underline="always">{t('context.back')}</Link>} titleAs="h2" bordered={false} className="min-w-0" />
      : context.error
        ? <ErrorPanel icon={ServerCrash as ComponentProps<typeof ErrorPanel>['icon']} title={t('context.errorTitle')} message={t('context.errorMessage')}
          code={context.error.status ?? t('context.networkCode')} requestId="" details="" onRetry={undefined} retrying={false} retryLabel=""
          secondaryAction={null} titleAs="h2" announce={true} className="min-w-0"
          labels={{ title: t('context.errorTitle'), message: t('context.errorMessage'), support: '', retry: '', retrying: '', retryingStatus: '', requestId: '', copyRequestId: '', copied: '', requestIdCopied: '', details: '' }} />
        : null

  return <I18nProvider locale={language.language}>
    <SettingsLayout groups={[{ items: [
      { id: 'profile', label: t('nav.profile'), href: '/console/profile', current: true },
      { id: 'settings', label: t('nav.settings'), href: '/console/settings', current: false },
    ] }]} value="profile" defaultValue={undefined} onValueChange={(_, selected) => { if (selected.href) navigate(selected.href) }}
      navLabel={t('nav.label')} selectLabel={t('nav.label')} skipLinkLabel={t('title')}
      title={null} description={null} saveBar="none" embedded={true} fullScreen={false} width="wide" mainId="console-profile"
      className="console-profile min-w-0 wrap-anywhere"
      header={<div className="flex items-start gap-3"><PageHeader as="div" title={t('title')} wrapTitle={true} description={t('description')}
        breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null} className="min-w-0 flex-1"
        labels={{ title: t('title'), description: t('description'), moreActions: '', sections: '' }} /><Badge variant="soft">{t('badge')}</Badge></div>}>
      <div className="min-w-0 space-y-6">
        <section aria-busy={context.loading} aria-label={t('title')}>
          {context.loading ? <TableSkeleton rows={4} columns={2} label={t('loading.identity')} className="min-w-0" />
            : <DescriptionListCard title={title} description={secondary} items={items} columns={2} wrap={true} titleAs="h2"
              onEdit={undefined} onCopy={undefined} editLabel="" className="min-w-0"
              labels={{ title, description: secondary, edit: '', copy: () => '', copied: () => '', copiedToClipboard: '' }} />}
        </section>
        {!context.loading && contextError}
        <section aria-labelledby="profile-roles" aria-busy={context.loading} className="min-w-0 space-y-4">
          <SectionHeader title={t('roles.title')} description={t('roles.description')} count={undefined} actions={[]}
            as="h2" headingId="profile-roles" bordered={false} className="min-w-0" />
          {context.loading ? <ListSkeleton rows={2} label={t('loading.roles')} className="min-w-0" />
            : permissions.roles.length > 0 ? <div className="flex flex-wrap gap-2">{permissions.roles.map((role) => <Badge key={role} variant="soft" className="whitespace-normal wrap-anywhere">{role}</Badge>)}</div>
              : <NoResultsEmpty query="" filterCount={0} entity="" onClearFilters={undefined} onClearSearch={undefined} titleAs="h3" bordered={false} className="min-w-0"
                labels={{ title: () => t('roles.emptyTitle'), queryTitle: () => t('roles.emptyTitle'), description: () => t('roles.emptyDescription'), clearFilters: '', clearSearch: '' }} />}
        </section>
      </div>
    </SettingsLayout>
  </I18nProvider>
}
