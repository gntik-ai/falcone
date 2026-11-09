import { useCallback } from 'react'
import { Page, I18nProvider, LiveAnnouncer, ToastProvider, useAnnounce, useToast } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { useCopy } from './consoleIamAccess/copy'
import { userIdOf } from './consoleIamAccess/api'
import { ConfirmDialog } from './consoleIamAccess/Confirm'
import { Detail } from './consoleIamAccess/Detail'
import { Forms } from './consoleIamAccess/Forms'
import { Empty, Failed, Loading, MutationCallout, NoAccess } from './consoleIamAccess/States'
import { LocalizedToaster } from './consoleIamAccess/Toaster'
import { Users } from './consoleIamAccess/Users'
import { useIamAccess } from './consoleIamAccess/useIamAccess'
import './consoleIamAccess/page.css'

function Surface({ realm, tenantLabel }: { realm: string; tenantLabel: string }) {
  const { t } = useCopy()
  const announce = useAnnounce()
  const toast = useToast()
  // Successes are announced politely and shown as a toast; neither ever carries a password.
  const notify = useCallback((key: string, values?: Record<string, string>) => {
    const message = t(key, values)
    announce(message, 'polite')
    toast.add({ title: message, tone: 'success', priority: 'low' })
  }, [announce, toast, t])
  const iam = useIamAccess(realm, notify)
  const { catalog } = iam
  const content = !catalog && iam.loading && !iam.loadFailure
    ? <Loading title={t('loading.title')} description={t('loading.description')} />
    : iam.loadFailure
      ? iam.loadFailure.status === 403
        ? <NoAccess />
        : <Failed title={t('catalogError.title')} failure={iam.loadFailure} retryLabel={t('catalogError.retry')} retry={() => { void iam.reload() }} fallback="catalog" />
      : catalog && <>
        <Forms roles={catalog.roles} busy={iam.busy} onCreateUser={iam.createUser} onCreateRole={iam.createRole} onCreateGroup={iam.createGroup} />
        <div className="grid min-w-0 gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <Users total={catalog.total} loaded={catalog.users.length} loading={iam.loading} busy={iam.busy} search={iam.search} filtered={iam.filteredUsers} paged={iam.pagedUsers} page={iam.currentPage} pageCount={iam.pageCount} selectedUserId={iam.selectedUserId}
              onSearch={iam.setSearch} onClearSearch={iam.clearSearch} onPage={iam.setPage} onReload={() => { void iam.reload() }} onSelect={iam.selectUser} onStatus={(user, enabled, focusKey) => { void iam.setStatus(user, enabled, focusKey) }}
              onDelete={(user, opener) => iam.openConfirm({ kind: 'deleteUser', user }, opener)} onCreateFocus={() => iam.restoreFocus('create-user-username')} />
          </div>
          <div className="min-w-0 xl:col-span-1">
            <Detail key={iam.selectedUserId ?? ''} user={iam.selectedUser} detail={iam.detail} busy={iam.busy} allRoles={catalog.roles} allGroups={catalog.groups}
              onStatus={(user, enabled, focusKey) => { void iam.setStatus(user, enabled, focusKey) }} onDelete={(user, opener) => iam.openConfirm({ kind: 'deleteUser', user }, opener)}
              onRemoveRole={(user, roleName, opener) => iam.openConfirm({ kind: 'removeRole', userId: userIdOf(user), username: user.username, roleName }, opener)}
              onRemoveGroup={(user, group, opener) => iam.openConfirm({ kind: 'removeGroup', userId: userIdOf(user), username: user.username, group }, opener)}
              onAssignRole={(roleName) => { void iam.assignRole(roleName) }} onAddGroup={(group) => { void iam.addGroup(group) }} onRetry={iam.retryDetail} onBack={iam.clearSelection} />
          </div>
        </div>
      </>
  return <>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-iam-access-page"
      header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} tabs={null} actions={[]}
        meta={[{ label: t('organization'), value: tenantLabel, icon: undefined, mono: false }, { label: t('realm'), value: realm, icon: undefined, mono: true }]}
        labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
      {iam.mutationError && <MutationCallout messageKey={iam.mutationError} />}
      {content}
    </Page>
    <ConfirmDialog state={iam.confirm} onConfirm={() => { void iam.submitConfirm() }} onClose={iam.closeConfirm} onClosed={iam.dropConfirm} />
  </>
}

// The realm is the active tenant id. Without a tenant the page renders its empty state and sends no request.
export default function ConsoleIamAccessPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  const realm = context.activeTenantId
  const tenant = context.tenants.find((item) => item.tenantId === realm)
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('close'), 'common.cancel': t('confirm.cancel') }}><LiveAnnouncer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    {realm
      ? <Surface key={realm} realm={realm} tenantLabel={tenant?.displayName ?? t('noSelection')} />
      : <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-iam-access-page"
        header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} tabs={null} actions={[]}
          meta={[{ label: t('organization'), value: t('noSelection'), icon: undefined, mono: false }]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
        <Empty title={t('noTenant.title')} description={t('noTenant.description')} />
      </Page>}
    <LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
